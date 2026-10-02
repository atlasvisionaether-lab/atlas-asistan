'use strict';

/**
 * Ana sayfadaki tarama ilerleme çubuğunun sınaması.
 *
 * NEDEN BU DOSYA VAR
 *
 * Yayında tarama %85'te ("rapor oluşturuluyor") sonsuza kadar dönüyordu.
 * Sebep sunucu değil, istemcideki KAÇAK SAYAÇTI: `runScan` tahmini ilerleme
 * sayacını yerel bir değişkende tutuyordu ve kuyruk ucu 404 döndüğünde
 * (bayrak kapalı, yani NORMAL durum) eşzamanlı yola düşerken ikinci bir
 * sayaç başlatıyordu. İlk sayaç o yolda hiç durdurulmadığı için ikisi
 * birlikte koşuyor, `clearInterval` yalnızca sonuncusunu durduruyordu.
 * Kaçak sayaç son adımda sıkışıp kalıyor ve sonuç gelip çubuk %100
 * yazıldıktan ~900 ms sonra üstüne tekrar %85 yazıyordu.
 *
 * NASIL SINANIYOR
 *
 * Metin eşleştirmiyoruz: ilgili kod `index.html`'den SÖKÜLÜP ÇALIŞTIRILIYOR.
 * DOM, ağ ve zamanlayıcılar saplanıyor; sahte saat ileri sarılıyor. Böylece
 * "sonuç geldikten sonra ekrana ne yazılı" sorusu gerçekten ölçülüyor.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KAYNAK = path.join(__dirname, '..', 'index.html');

let gecti = 0;
const hatalar = [];
function dogru(ad, kosul) { if (kosul) { gecti += 1; return; } hatalar.push(ad); }
function esit(ad, bulunan, beklenen) {
  if (bulunan === beklenen) { gecti += 1; return; }
  hatalar.push(ad + ' (beklenen ' + JSON.stringify(beklenen)
    + ', bulunan ' + JSON.stringify(bulunan) + ')');
}

const html = fs.readFileSync(KAYNAK, 'utf8');

/* ---- İlgili kod bloğunu sök ---- */
const BAS = '    var PROGRESS_STEPS = [';
const SON = '    /** Kuyruğa alınan taramayı belirli aralıklarla sorar;';
const i = html.indexOf(BAS);
const j = html.indexOf(SON);
if (i === -1 || j === -1 || j <= i) {
  console.error('sınama kaynağı bulamadı: index.html içindeki ilerleme bloğu '
    + 'taşınmış olabilir. Sınırları güncelle.');
  process.exit(1);
}
const BLOK = html.slice(i, j);

/* Sökülen blok gerçekten aradığımız kodu mu taşıyor? Taşınma hâlinde sınama
   sessizce boş geçmesin. */
['function startProgress', 'function stopProgress', 'function runScan',
  'PROGRESS_STEPS'].forEach(function (parca) {
  dogru('sökülen blok ' + parca + ' içeriyor', BLOK.indexOf(parca) !== -1);
});

/** Sahte saat: setInterval/setTimeout kuyruğunu elle ileri sarıyor. */
function saatYap() {
  let simdi = 0;
  let sonrakiId = 1;
  const isler = new Map();

  function setInterval_(fn, ms) {
    const id = sonrakiId++;
    isler.set(id, { fn: fn, ms: Math.max(1, ms), next: simdi + Math.max(1, ms), tekrar: true });
    return id;
  }
  function setTimeout_(fn, ms) {
    const id = sonrakiId++;
    isler.set(id, { fn: fn, ms: Math.max(0, ms), next: simdi + Math.max(0, ms), tekrar: false });
    return id;
  }
  function clear_(id) { isler.delete(id); }

  /** Saati `ms` kadar ileri sarar, arada mikro görevleri boşaltır. */
  async function ilerle(ms) {
    const hedef = simdi + ms;
    let koruma = 0;
    while (koruma++ < 100000) {
      let enYakin = null;
      isler.forEach(function (is, id) {
        if (is.next <= hedef && (enYakin === null || is.next < enYakin.is.next)) {
          enYakin = { id: id, is: is };
        }
      });
      if (enYakin === null) break;
      simdi = enYakin.is.next;
      if (enYakin.is.tekrar) { enYakin.is.next = simdi + enYakin.is.ms; }
      else { isler.delete(enYakin.id); }
      enYakin.is.fn();
      await Promise.resolve();        // mikro görevleri boşalt
      await Promise.resolve();
    }
    simdi = hedef;
    await Promise.resolve();
  }

  return {
    setInterval: setInterval_, setTimeout: setTimeout_,
    clearInterval: clear_, clearTimeout: clear_,
    ilerle: ilerle,
    get etkinSayac() {
      let n = 0;
      isler.forEach(function (is) { if (is.tekrar) n += 1; });
      return n;
    }
  };
}

/**
 * Bloğu saplamalarla çalıştırır ve `runScan`'i döndürür.
 * @param {object} ayar { kuyruk: 'ok'|'404', senkron: 'ok'|'hata',
 *                        rendererDurdurur: bool }
 */
function kur(ayar) {
  const saat = saatYap();
  const ekran = { genislik: null, durum: null, ikon: null, gecmis: [] };

  const scanBar = { style: { set width(v) { ekran.genislik = v; ekran.gecmis.push(v); },
    get width() { return ekran.genislik; } } };

  function setStatus(text, ikon) { ekran.durum = text; ekran.ikon = ikon || null; }
  function t(key) { return key; }

  const cagrilar = { render: 0, hata: 0, poll: 0, enqueue: 0, senkron: 0 };

  const API = {
    enqueueScan: function () {
      cagrilar.enqueue += 1;
      /* Gerçek istemci 404'te { code: 'enqueue_unavailable' } fırlatıyor. */
      if (ayar.kuyruk === '404') return Promise.reject({ code: 'enqueue_unavailable' });
      return Promise.resolve({ scanId: 'is-1' });
    },
    startScan: function () {
      cagrilar.senkron += 1;
      /* Eşzamanlı tarama ~2 sn sürüyor: sayaç bu sürede son adıma varıyor. */
      return new Promise(function (resolve, reject) {
        saat.setTimeout(function () {
          if (ayar.senkron === 'hata') reject({ code: 'scan_failed' });
          else resolve({ url: 'https://ornek.com/', score: 88,
            summary: { passed: 8, failed: 2, skipped: 0 }, checks: [], warnings: [] });
        }, 2000);
      });
    }
  };

  /* Kuyruk yolunun yoklaması (modül içi pollScan) saplanıyor. */
  function pollScan() {
    cagrilar.poll += 1;
    return new Promise(function (resolve) {
      saat.setTimeout(function () {
        resolve({ url: 'https://ornek.com/', score: 90,
          summary: { passed: 9, failed: 1, skipped: 0 }, checks: [], warnings: [] });
      }, 3000);
    });
  }

  /* RENDERER KASITLI OLARAK SAYACI DURDURMUYOR (ayar.rendererDurdurur false
     ise). Böylece sınama `runScan`'in KENDİ defterinin doğru olduğunu
     ölçüyor; renderer'daki stopProgress ek bir emniyet, tek savunma değil. */
  const sandbox = {
    PROGRESS_STEPS: null,
    setInterval: saat.setInterval, clearInterval: saat.clearInterval,
    setTimeout: saat.setTimeout, clearTimeout: saat.clearTimeout,
    scanBar: scanBar, setStatus: setStatus, t: t, API: API, pollScan: pollScan,
    scanning: false,
    scanSubmit: { disabled: false },
    scanOutput: { classList: { add: function () {}, remove: function () {} } },
    scanLog: { textContent: '' },
    scanSummary: { hidden: true, querySelector: function () { return null; } },
    addNoticeRow: function () {},
    renderScanResult: function () {
      cagrilar.render += 1;
      if (ayar.rendererDurdurur) sandbox.stopProgress();
      scanBar.style.width = '100%';
      setStatus('scan.done', 'fa-solid fa-circle-check');
    },
    renderScanError: function () {
      cagrilar.hata += 1;
      if (ayar.rendererDurdurur) sandbox.stopProgress();
      setStatus('scan.error', 'fa-solid fa-circle-exclamation');
    },
    console: console
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext('(function () {\n' + BLOK
    + '\n  this.runScan = runScan; this.stopProgress = stopProgress;'
    + '\n  this.startProgress = startProgress;'
    + '\n}).call(globalThis);', sandbox);

  return { runScan: sandbox.runScan, stopProgress: sandbox.stopProgress,
    startProgress: sandbox.startProgress,
    saat: saat, ekran: ekran, cagrilar: cagrilar };
}

async function kos() {
  /* ---- 1. ASIL HATA: kuyruk 404, eşzamanlı yol başarılı ---- */
  {
    const k = kur({ kuyruk: '404', senkron: 'ok', rendererDurdurur: false });
    k.runScan('ornek.com');
    await Promise.resolve();

    await k.saat.ilerle(3000);        // tarama bitti (2 sn) + pay

    esit('eşzamanlı yola düşüldü', k.cagrilar.senkron, 1);
    esit('sonuç bir kez işlendi', k.cagrilar.render, 1);
    esit('sonuçtan sonra çubuk %100', k.ekran.genislik, '100%');

    /* Hatanın tam belirtisi: aradan zaman geçince kaçak sayaç %85 yazıyordu. */
    await k.saat.ilerle(5000);
    esit('5 sn sonra çubuk HÂLÂ %100 (kaçak sayaç yok)', k.ekran.genislik, '100%');
    esit('5 sn sonra durum hâlâ bitti', k.ekran.durum, 'scan.done');
    dogru('durum metni "rapor oluşturuluyor"a geri DÖNMÜYOR',
      k.ekran.durum.indexOf('scan.progress.report') === -1);
    esit('çalışan sayaç kalmadı', k.saat.etkinSayac, 0);
  }

  /* ---- 2. Kuyruk yolu çalışıyor ---- */
  {
    const k = kur({ kuyruk: 'ok', senkron: 'ok', rendererDurdurur: false });
    k.runScan('ornek.com');
    await Promise.resolve();
    await k.saat.ilerle(4000);

    esit('kuyruk yolunda yoklama yapıldı', k.cagrilar.poll, 1);
    esit('kuyruk yolunda eşzamanlı tarama çağrılmadı', k.cagrilar.senkron, 0);
    esit('kuyruk yolunda sonuç işlendi', k.cagrilar.render, 1);
    esit('kuyruk yolunda çubuk %100', k.ekran.genislik, '100%');
    await k.saat.ilerle(5000);
    esit('kuyruk yolunda da kaçak sayaç yok', k.ekran.genislik, '100%');
    esit('kuyruk yolunda çalışan sayaç kalmadı', k.saat.etkinSayac, 0);
  }

  /* ---- 3. Eşzamanlı yol hata verirse ---- */
  {
    const k = kur({ kuyruk: '404', senkron: 'hata', rendererDurdurur: false });
    k.runScan('ornek.com');
    await Promise.resolve();
    await k.saat.ilerle(3000);

    esit('hata ekranı gösterildi', k.cagrilar.hata, 1);
    await k.saat.ilerle(5000);
    esit('hatadan sonra durum hata olarak kalıyor', k.ekran.durum, 'scan.error');
    esit('hatadan sonra çalışan sayaç kalmadı', k.saat.etkinSayac, 0);
  }

  /* ---- 4. Sayaç tek: iki kez başlatmak ikinciyi bırakmıyor ---- */
  {
    const k = kur({ kuyruk: '404', senkron: 'ok', rendererDurdurur: false });
    k.startProgress();
    k.startProgress();
    k.startProgress();
    esit('üç kez başlatılsa da tek sayaç koşuyor', k.saat.etkinSayac, 1);
    k.stopProgress();
    esit('durdurunca hiç sayaç kalmıyor', k.saat.etkinSayac, 0);
    k.stopProgress();
    esit('iki kez durdurmak güvenli', k.saat.etkinSayac, 0);
  }

  /* ---- 5. Tahmini ilerleme hâlâ çalışıyor (düzeltme çubuğu dondurmadı) ---- */
  {
    const k = kur({ kuyruk: '404', senkron: 'ok', rendererDurdurur: false });
    k.runScan('ornek.com');
    /* Eşzamanlı yola düşmek birkaç mikro görev sürüyor ve o yolda sayaç
       YENİDEN başlıyor, yani ilk adıma döner. Ölçüm ondan sonra yapılmalı. */
    for (let n = 0; n < 10; n++) await Promise.resolve();
    esit('ilk adım %5', k.ekran.genislik, '5%');
    await k.saat.ilerle(950);
    esit('sayaç ikinci adıma geçti', k.ekran.genislik, '25%');
    await k.saat.ilerle(950);
    esit('sayaç üçüncü adıma geçti', k.ekran.genislik, '55%');
    dogru('ilerleme adımları akıyor',
      k.ekran.gecmis.indexOf('25%') !== -1 && k.ekran.gecmis.indexOf('55%') !== -1);
  }

  /* ---- 6. Nihai durum yazanlar sayacı da durduruyor (ek emniyet) ---- */
  {
    const gercek = html;
    const r = gercek.indexOf('function renderScanResult(result) {');
    const h = gercek.indexOf('function renderScanError(err) {');
    dogru('renderScanResult stopProgress çağırıyor',
      gercek.slice(r, r + 400).indexOf('stopProgress()') !== -1);
    dogru('renderScanError stopProgress çağırıyor',
      gercek.slice(h, h + 400).indexOf('stopProgress()') !== -1);
    /* Yorum metni `ticker`dan söz ediyor (hatanın anlatımı), bu yüzden
       kelime değil KOD aranıyor: bildirim ve clearInterval çağrısı. */
    dogru('yerel `ticker` bildirimi kalmadı',
      gercek.indexOf('var ticker') === -1);
    dogru('clearInterval(ticker) çağrısı kalmadı',
      gercek.indexOf('clearInterval(ticker)') === -1);
  }

  if (hatalar.length) {
    console.error('\nilerleme sınaması: ' + hatalar.length + ' KALDI, ' + gecti + ' geçti\n');
    hatalar.forEach(function (h) { console.error('  ✗ ' + h); });
    process.exit(1);
  }
  console.log('İlerleme çubuğu sınaması: ' + gecti + ' / ' + gecti + ' geçti');
}

kos().catch(function (err) {
  console.error('sınama çöktü:', (err && err.stack) || err);
  process.exit(1);
});
