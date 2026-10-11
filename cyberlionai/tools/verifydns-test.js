'use strict';

/**
 * `/api/verify-dns` sınaması. Uç GERÇEKTEN çağrılıyor: `_lib/mail.js` ve
 * `_lib/store.js` saplanıyor, ağ yok, handler kendi kodu ile yürüyor.
 *
 * Sabitlenen kararlar:
 *   - `p=none` KIRMIZI: kayıt bulunmuş sayılır ama politika 'none' ve
 *     status 'fail' döner.
 *   - SPF'te `found` varlık değil KORUMA demek: `+all` / `?all` / birden
 *     fazla kayıt yeşil göstermez.
 *   - POST hiçbir hata yolunda 404 DÖNMEZ. Ekran POST'a gelen 404'ü "uç
 *     yayında değil" diye okuyor; çözülmeyen bir alan adına 404 vermek
 *     kullanıcıya yanlış cümle kurdurur.
 *   - Hız sayacı çalışmıyorsa uç KAPALI (503), çünkü uç istemcinin seçtiği
 *     alan adına bizim altyapımızdan DNS sorgusu attırıyor.
 */

const path = require('node:path');
const Module = require('node:module');

const API = path.join(__dirname, '..', 'api');

let gecti = 0;
const hatalar = [];
function dogru(ad, kosul) { if (kosul) { gecti += 1; return; } hatalar.push(ad); }
function esit(ad, bulunan, beklenen) {
  if (bulunan === beklenen) { gecti += 1; return; }
  hatalar.push(ad + ' (beklenen ' + JSON.stringify(beklenen)
    + ', bulunan ' + JSON.stringify(bulunan) + ')');
}

function sapla(gorecelYol, govde) {
  const tam = require.resolve(path.join(API, gorecelYol));
  const m = new Module(tam, null);
  m.filename = tam; m.loaded = true; m.exports = govde;
  require.cache[tam] = m;
  return tam;
}

function sahteRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; },
    status: function (k) { res.statusCode = k; return res; },
    json: function (b) { res.body = b; return res; },
    end: function () { return res; }
  };
  return res;
}

/* Gerçek ayrıştırıcılar kullanılıyor: sınama onların kararını değil, ucun
   o kararı sözleşmeye nasıl çevirdiğini ölçüyor. */
const gercekMail = require(path.join(API, '_lib', 'mail.js'));

function ucuYukle(ayar) {
  const o = ayar || {};
  const sayac = { dns: 0, cacheSet: 0 };
  const yollar = [];

  yollar.push(sapla('_lib/mail.js', {
    alanAdi: gercekMail.alanAdi,
    spfDegerlendir: gercekMail.spfDegerlendir,
    dmarcDegerlendir: gercekMail.dmarcDegerlendir,
    spfDmarcKayitlari: async function (alan) {
      sayac.dns += 1;
      if (o.dnsFirlat) throw new Error('boom');
      if (o.cozulmedi) return { ok: false, sebep: 'domain_not_found', alan: alan };
      /* o.sorguSirasi: her çağrı için ayrı sonuç — tekrar denemeyi sınamak
         için. Yoksa her çağrı aynı yanıtı verir. */
      const sira = o.sorguSirasi && o.sorguSirasi[sayac.dns - 1];
      const ayar = sira || o;
      return {
        ok: true, alan: alan,
        spf: ayar.spf || [], dmarc: ayar.dmarc || [],
        dmarcAd: ayar.dmarcAd || ('_dmarc.' + alan),
        spfSorgu: ayar.spfSorgu || { ok: true, kesin: true, kod: null },
        dmarcSorgu: ayar.dmarcSorgu || { ok: true, kesin: true, kod: null }
      };
    }
  }));

  yollar.push(sapla('_lib/store.js', {
    isConfigured: function () { return o.store !== false; },
    hitRateLimit: async function () {
      if (o.storeFirlat) throw new Error('store down');
      return o.hiz === false ? { count: 999, ttl: 42 } : { count: 1, ttl: 600 };
    },
    cacheGet: async function () { return o.onbellek || null; },
    cacheSet: async function () {
      sayac.cacheSet += 1;
      if (o.cacheSetFirlat) throw new Error('yazılamadı');
    },
    quotaKey: function () { return 'k'; }
  }));

  yollar.push(sapla('_lib/session.js', {
    clientIp: function () { return '203.0.113.7'; },
    ipKey: function (ip) { return ip; },
    resolveOwner: async function () { return {}; },
    ownerRef: function (x) { return x; }
  }));

  const uc = require.resolve(path.join(API, 'verify-dns.js'));
  delete require.cache[uc];
  return { handler: require(uc), sayac: sayac, yollar: yollar.concat([uc]) };
}

function temizle(y) { y.forEach(function (p) { delete require.cache[p]; }); }

async function cagir(ayar, govde, yontem) {
  const k = ucuYukle(ayar);
  const res = sahteRes();
  await k.handler({ method: yontem || 'POST', body: govde, query: {}, headers: {} }, res);
  temizle(k.yollar);
  return { res: res, sayac: k.sayac };
}

async function kos() {
  /* ---- 1. DMARC p=none KIRMIZI ---- */
  {
    const r = await cagir({ dmarc: ['v=DMARC1; p=none; rua=mailto:a@b.c'] },
      { domain: 'ornek.com' });
    esit('p=none 200 dönüyor', r.res.statusCode, 200);
    esit('p=none kayıt BULUNMUŞ sayılıyor', r.res.body.dmarc.found, true);
    esit('p=none politika none', r.res.body.dmarc.policy, 'none');
    esit('p=none sunucuda da başarısız', r.res.body.dmarc.status, 'fail');
    esit('p=none notu', r.res.body.dmarc.note, 'dmarc_monitor_only');
    /* Ekranın kırmızı sayması bu iki alana bağlı: found && policy !== 'none' */
    dogru('ekran mantığı p=none için kırmızı veriyor',
      !(r.res.body.dmarc.found === true
        && r.res.body.dmarc.policy && r.res.body.dmarc.policy !== 'none'));
  }

  /* ---- 2. p=reject yeşil, pct<100 kırmızı ---- */
  {
    const r = await cagir({ dmarc: ['v=DMARC1; p=reject; rua=mailto:a@b.c'] },
      { domain: 'ornek.com' });
    esit('p=reject politika', r.res.body.dmarc.policy, 'reject');
    esit('p=reject geçiyor', r.res.body.dmarc.status, 'pass');
    dogru('ekran mantığı p=reject için yeşil veriyor',
      r.res.body.dmarc.found === true && r.res.body.dmarc.policy !== 'none');
    dogru('ham kayıt geri dönüyor', /p=reject/.test(r.res.body.dmarc.record));

    const q = await cagir({ dmarc: ['v=DMARC1; p=reject; pct=50'] }, { domain: 'ornek.com' });
    esit('pct=50 başarısız', q.res.body.dmarc.status, 'fail');
    esit('pct=50 politikası yine reject okunuyor', q.res.body.dmarc.policy, 'reject');
  }

  /* ---- 3. SPF: found = KORUMA, varlık değil ---- */
  {
    const iyi = await cagir({ spf: ['v=spf1 include:_spf.google.com ~all'] },
      { domain: 'ornek.com' });
    esit('geçerli SPF bulundu', iyi.res.body.spf.found, true);
    esit('geçerli SPF durumu', iyi.res.body.spf.status, 'pass');
    dogru('geçerli SPF kaydı dönüyor', /v=spf1/.test(iyi.res.body.spf.record));

    const herkes = await cagir({ spf: ['v=spf1 +all'] }, { domain: 'ornek.com' });
    esit('+all YEŞİL DEĞİL', herkes.res.body.spf.found, false);
    esit('+all notu', herkes.res.body.spf.note, 'spf_allows_all');
    dogru('+all kaydı yine görünür', /\+all/.test(herkes.res.body.spf.record));

    const notr = await cagir({ spf: ['v=spf1 ?all'] }, { domain: 'ornek.com' });
    esit('?all YEŞİL DEĞİL', notr.res.body.spf.found, false);
    esit('?all notu', notr.res.body.spf.note, 'spf_neutral');

    const coklu = await cagir({ spf: ['v=spf1 ~all', 'v=spf1 -all'] }, { domain: 'ornek.com' });
    esit('iki SPF kaydı YEŞİL DEĞİL', coklu.res.body.spf.found, false);
    esit('iki SPF kaydı notu', coklu.res.body.spf.note, 'spf_multiple');

    const allsiz = await cagir({ spf: ['v=spf1 include:x.com'] }, { domain: 'ornek.com' });
    esit('all mekanizması yok YEŞİL DEĞİL', allsiz.res.body.spf.found, false);
    esit('all yok notu', allsiz.res.body.spf.note, 'spf_no_all');
  }

  /* ---- 4. Hiç kayıt yok ---- */
  {
    const r = await cagir({ spf: [], dmarc: [] }, { domain: 'ornek.com' });
    esit('kayıt yok: 200', r.res.statusCode, 200);
    esit('SPF bulunamadı', r.res.body.spf.found, false);
    esit('SPF kaydı null', r.res.body.spf.record, null);
    esit('DMARC bulunamadı', r.res.body.dmarc.found, false);
    esit('DMARC politikası null', r.res.body.dmarc.policy, null);
    esit('DMARC kaydı null', r.res.body.dmarc.record, null);
  }

  /* ---- 5. Alan adı normalizasyonu ---- */
  {
    const durumlar = [
      ['https://WWW.Ornek.COM/yol?a=1', 'ornek.com', 'şema, www, yol ve sorgu atılıyor'],
      ['ornek.com.', 'ornek.com', 'kök noktası atılıyor'],
      ['ornek.com:8443', 'ornek.com', 'port atılıyor'],
      ['posta@ornek.com', 'ornek.com', 'e-posta adresinden alan adı'],
      ['  Ornek.Com  ', 'ornek.com', 'boşluk ve büyük harf'],
      ['alt.ornek.com.tr', 'alt.ornek.com.tr', 'çok etiketli ad korunuyor'],
      /* Yapıştırılan adresin yolu atılıyor; ad geçerli kalıyor. */
      ['ornek.com/../x', 'ornek.com', 'yol kalıntısı temizleniyor']
    ];
    for (const [girdi, beklenen, ad] of durumlar) {
      const r = await cagir({ spf: [] }, { domain: girdi });
      esit('normalize: ' + ad, r.res.body && r.res.body.domain, beklenen);
    }
  }

  /* ---- 6. Reddedilen girdiler ---- */
  {
    const kotu = [
      ['', 'empty', 'boş'],
      ['   ', 'empty', 'yalnızca boşluk'],
      ['localhost', 'bad_domain', 'noktasız ad'],
      ['sunucu.localhost', 'bad_domain', 'localhost son eki'],
      ['makine.internal', 'bad_domain', 'internal son eki'],
      ['192.168.1.1', 'bad_domain', 'IP adresi'],
      ['8.8.8.8', 'bad_domain', 'genel IP adresi'],
      ['-ornek.com', 'bad_domain', 'tire ile başlayan etiket'],
      ['ornek..com', 'bad_domain', 'boş etiket'],
      [('a'.repeat(60) + '.').repeat(5) + 'com', 'bad_domain', '253 bayttan uzun']
    ];
    for (const [girdi, kod, ad] of kotu) {
      const r = await cagir({}, { domain: girdi });
      esit('reddet (' + ad + ') durum', r.res.statusCode, 400);
      esit('reddet (' + ad + ') kod',
        (r.res.body && r.res.body.error && r.res.body.error.code) || JSON.stringify(r.res.body),
        kod);
      esit('reddet (' + ad + ') DNS sorgusu atılmadı', r.sayac.dns, 0);
    }
    const bos = await cagir({}, {});
    esit('domain alanı yok: 400', bos.res.statusCode, 400);
    const sayi = await cagir({}, { domain: 12345 });
    esit('domain sayı: 400', sayi.res.statusCode, 400);
  }

  /* ---- 7. Çözülmeyen alan adı 404 DEĞİL ---- */
  {
    const r = await cagir({ cozulmedi: true }, { domain: 'yok-boyle-bir-ad-9182.com' });
    esit('çözülmeyen ad 422', r.res.statusCode, 422);
    esit('çözülmeyen ad kodu', r.res.body.error.code, 'domain_not_found');
    dogru('POST 404 DÖNMÜYOR (ekran bunu "uç yayında değil" sanardı)',
      r.res.statusCode !== 404);
  }

  /* ---- 8. Hız sınırı ve kapalı devre ---- */
  {
    const r = await cagir({ hiz: false }, { domain: 'ornek.com' });
    esit('sınır aşıldı 429', r.res.statusCode, 429);
    esit('Retry-After veriliyor', r.res.headers['retry-after'], '42');
    esit('sınır aşıldıysa DNS sorgusu atılmıyor', r.sayac.dns, 0);

    const yok = await cagir({ store: false }, { domain: 'ornek.com' });
    esit('sayaç yapılandırılmamış: 503', yok.res.statusCode, 503);
    esit('sayaç yoksa DNS sorgusu atılmıyor', yok.sayac.dns, 0);

    const dustu = await cagir({ storeFirlat: true }, { domain: 'ornek.com' });
    esit('sayaç düştü: 503 (kapalı devre)', dustu.res.statusCode, 503);
    esit('sayaç düştüyse DNS sorgusu atılmıyor', dustu.sayac.dns, 0);
  }

  /* ---- 9. Önbellek ---- */
  {
    const hazir = { domain: 'ornek.com', spf: { found: true }, dmarc: { found: true } };
    const r = await cagir({ onbellek: hazir }, { domain: 'ornek.com' });
    esit('önbellekten 200', r.res.statusCode, 200);
    esit('önbellek sonucu aynen dönüyor', r.res.body.domain, 'ornek.com');
    esit('önbellek varsa DNS sorgusu atılmıyor', r.sayac.dns, 0);

    const taze = await cagir({ spf: ['v=spf1 -all'] }, { domain: 'ornek.com' });
    esit('önbellek yoksa DNS sorgusu atılıyor', taze.sayac.dns, 1);
    esit('sonuç önbelleğe yazılıyor', taze.sayac.cacheSet, 1);

    const yazilamadi = await cagir({ spf: ['v=spf1 -all'], cacheSetFirlat: true },
      { domain: 'ornek.com' });
    esit('önbelleğe yazılamazsa sonuç yine dönüyor', yazilamadi.res.statusCode, 200);
  }

  /* ---- 10. DNS düştü ---- */
  {
    const r = await cagir({ dnsFirlat: true }, { domain: 'ornek.com' });
    esit('DNS hatası 502', r.res.statusCode, 502);
    esit('DNS hatası kodu', r.res.body.error.code, 'dns_failed');
    dogru('DNS hatasında da 404 dönmüyor', r.res.statusCode !== 404);
  }

  /* ---- 11. Yöntemler ---- */
  {
    const g = await cagir({}, null, 'GET');
    esit('GET 404 (iş kimliği üretilmiyor)', g.res.statusCode, 404);
    esit('GET kodu', g.res.body.error.code, 'no_async_job');

    const p = await cagir({}, null, 'PUT');
    esit('PUT 405', p.res.statusCode, 405);
    esit('PUT Allow başlığı', p.res.headers['allow'], 'POST');
  }

  /* ---- 12. Önbelleklenmemesi gereken yanıt başlığı ---- */
  {
    const r = await cagir({ spf: ['v=spf1 -all'] }, { domain: 'ornek.com' });
    esit('Cache-Control no-store', r.res.headers['cache-control'], 'no-store');
    /* DMARC kaydının HANGİ isimde bulunduğu söyleniyor: üst alan adına
       düşüldüyse kullanıcı kendi alanında arayıp bulamaz. */
    const ust = await cagir({ dmarc: ['v=DMARC1; p=reject'], dmarcAd: '_dmarc.ornek.com' },
      { domain: 'alt.ornek.com' });
    esit('kaydın bulunduğu ad dönüyor', ust.res.body.dmarc.recordName, '_dmarc.ornek.com');
  }

  /* ---- 13. ÖLÇÜLEMEYEN sorgu "yok" sayılmıyor ---- */
  {
    const ZAMAN_ASIMI = { ok: false, kesin: false, kod: 'ETIMEOUT' };

    /* Asıl tehlike: kaydı DOĞRU olan müşteriye "SPF yok" demek. */
    const spfDustu = await cagir({ spfSorgu: ZAMAN_ASIMI }, { domain: 'ornek.com' });
    esit('SPF sorgusu düştüyse 502', spfDustu.res.statusCode, 502);
    esit('SPF düştüyse kod', spfDustu.res.body.error.code, 'dns_failed');
    esit('hangi kaydın ölçülemediği söyleniyor', spfDustu.res.body.error.record, 'spf');
    dogru('ölçülemeyen sorgu "bulunamadı" olarak DÖNMÜYOR',
      !spfDustu.res.body.spf);
    esit('ölçülemeyen sorgu bir kez tekrar deniyor', spfDustu.sayac.dns, 2);
    esit('ölçülemeyen sonuç önbelleğe YAZILMIYOR', spfDustu.sayac.cacheSet, 0);

    const dmarcDustu = await cagir({ dmarcSorgu: ZAMAN_ASIMI }, { domain: 'ornek.com' });
    esit('DMARC sorgusu düştüyse 502', dmarcDustu.res.statusCode, 502);
    esit('DMARC düştüyse hangi kayıt', dmarcDustu.res.body.error.record, 'dmarc');

    /* Tekrarda düzelirse cevap veriliyor: geçici düşme kullanıcıya yansımıyor. */
    const duzeldi = await cagir({ sorguSirasi: [
      { spfSorgu: ZAMAN_ASIMI },
      { spf: ['v=spf1 -all'], dmarc: ['v=DMARC1; p=reject'] }
    ] }, { domain: 'ornek.com' });
    esit('tekrarda düzelirse 200', duzeldi.res.statusCode, 200);
    esit('tekrarda düzelirse SPF bulundu', duzeldi.res.body.spf.found, true);
    esit('tekrar tam olarak bir kez', duzeldi.sayac.dns, 2);

    /* ENODATA kesin bir cevap: isim var, kayıt yok. Burada "yok" doğru. */
    const gercektenYok = await cagir({
      spf: [], spfSorgu: { ok: false, kesin: true, kod: 'ENODATA' },
      dmarc: [], dmarcSorgu: { ok: false, kesin: true, kod: 'ENODATA' }
    }, { domain: 'ornek.com' });
    esit('ENODATA 200 dönüyor', gercektenYok.res.statusCode, 200);
    esit('ENODATA SPF gerçekten yok', gercektenYok.res.body.spf.found, false);
    esit('ENODATA DMARC gerçekten yok', gercektenYok.res.body.dmarc.found, false);
    esit('kesin cevap tekrar denenmiyor', gercektenYok.sayac.dns, 1);
  }

  if (hatalar.length) {
    console.error('\nverify-dns: ' + hatalar.length + ' KALDI, ' + gecti + ' geçti\n');
    hatalar.forEach(function (h) { console.error('  ✗ ' + h); });
    process.exit(1);
  }
  console.log('verify-dns sınaması: ' + gecti + ' / ' + gecti + ' geçti');
}

kos().catch(function (err) {
  console.error('sınama çöktü:', (err && err.stack) || err);
  process.exit(1);
});
