'use strict';

/**
 * TWA denetimi: uygulamanın açtığı adresin GERÇEK yanıtlarını ölçer.
 *
 *   TWA_HOST=https://cyberlionai-c320e.web.app node tools/twa-verify.js
 *   TWA_PACKAGE=com.cyberlionai.app (varsayılan)
 *
 * Ağ GEREKİR; kapta çıkış kapalı olduğu için GitHub Actions'ta koşuyor
 * (.github/workflows/twa-verify.yml).
 *
 * Neden böyle bir betik: telefondaki "Tekrar deneyin" (uydu/çanak simgesi)
 * Chrome'un AĞ HATASI sayfasıdır. Uygulama o sayfayı gösteriyorsa, açtığı
 * adres ya yüklenmiyor ya BAŞKA bir kaynağa gidiyor. "Chrome'da açılıyor"
 * bunu çürütmez: Chrome elle yazılan adresi açar, TWA ise APK içine
 * GÖMÜLÜ adresi açar; ikisi aynı olmak zorunda değil.
 *
 * Ölçülenler ve her birinin hangi arızayı yakaladığı:
 *   1. Açılış adresi 200 mü, nereye yönleniyor      → "Tekrar deneyin"
 *   2. Yönlendirme kaynak (origin) değiştiriyor mu   → adres çubuğu + hata
 *   3. assetlinks.json JSON olarak mı dönüyor        → Firebase/SPA rewrite tuzağı
 *   4. Paket adı ve parmak izi biçimi                → doğrulama başarısız
 *   5. Google'ın kendi doğrulayıcısı ne diyor        → kesin yanıt
 *   6. manifest start_url/scope aynı kaynakta mı     → kapsam dışına çıkış
 *   7. service worker var mı, kapsamı ne             → çevrimdışı önbellek
 */

const https = require('https');
const { URL } = require('url');

const HOST = String(process.env.TWA_HOST || '').trim().replace(/\/+$/, '');
const PAKET = String(process.env.TWA_PACKAGE || 'com.cyberlionai.app').trim();

if (!/^https:\/\/[^/]+$/.test(HOST)) {
  console.error('Kullanım: TWA_HOST=https://alan.adi node tools/twa-verify.js');
  process.exit(2);
}

let kaldi = 0;
const notlar = [];
function ok(ad, ek) { console.log('  ✓ ' + ad + (ek ? ' — ' + ek : '')); }
function hata(ad, ek) { kaldi++; console.log('  ✗ ' + ad + (ek ? ' — ' + ek : '')); }
function bilgi(ad, ek) { console.log('  · ' + ad + (ek ? ' — ' + ek : '')); }
/* Not yalnızca BAŞARISIZLIKTA yazılıyor: geçen bir denetimin yanına
   "X ≠ Y" basmak satırı kendi kendini yalanlar hâle getiriyordu. */
function bekle(k, ad, ek) { k ? ok(ad) : hata(ad, ek); }

/** Tek istek: yönlendirmeyi İZLEMİYOR, çünkü yönlendirmenin kendisi bulgu. */
function iste(adres, basliklar) {
  return new Promise(function (cozum) {
    let u;
    try { u = new URL(adres); } catch (e) { return cozum({ hata: 'gecersiz_adres' }); }
    const istek = https.request({
      method: 'GET',
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: Object.assign({
        /* Android'deki Chrome gibi görün: sunucu cihaza göre farklı yanıt
           veriyorsa (mobil yönlendirme) o da ölçüme girsin. */
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
        'Accept': '*/*'
      }, basliklar || {}),
      timeout: 20000
    }, function (y) {
      let g = '';
      y.on('data', function (p) { if (g.length < 400000) g += p; });
      y.on('end', function () {
        cozum({ durum: y.statusCode, basliklar: y.headers, govde: g });
      });
    });
    istek.on('timeout', function () { istek.destroy(); cozum({ hata: 'zaman_asimi' }); });
    istek.on('error', function (e) { cozum({ hata: e.code || e.message }); });
    istek.end();
  });
}

function ayniKaynak(a, b) {
  try { return new URL(a).origin === new URL(b).origin; } catch (e) { return false; }
}

async function main() {
  console.log('TWA denetimi');
  console.log('  ana makine : ' + HOST);
  console.log('  paket      : ' + PAKET);
  console.log('');

  /* ---- 1. Açılış adresi ---- */
  console.log('1. Açılış adresi (uygulamanın ilk istediği şey)');
  let adres = HOST + '/';
  let atlama = 0;
  let sonDurum = null;
  let sonGovde = '';
  while (atlama < 6) {
    const y = await iste(adres);
    if (y.hata) { hata(adres, 'ağ hatası: ' + y.hata); break; }
    sonDurum = y.durum;
    sonGovde = y.govde;
    const yer = y.basliklar.location;
    if (y.durum >= 300 && y.durum < 400 && yer) {
      const hedef = new URL(yer, adres).toString();
      /* Kaynak değiştiren yönlendirme TWA'yı kapsam dışına atar: uygulama
         ya adres çubuğu gösterir ya Custom Tabs'a düşer. */
      bekle(ayniKaynak(hedef, HOST + '/'), 'yönlendirme ' + y.durum + ' → ' + hedef,
        'KAYNAK DEĞİŞİYOR, TWA kapsamı dışı');
      adres = hedef; atlama++; continue;
    }
    bekle(y.durum === 200, 'GET ' + adres + ' → ' + y.durum);
    bilgi('içerik türü', String(y.basliklar['content-type'] || '—'));
    break;
  }
  if (atlama >= 6) hata('yönlendirme döngüsü', '6 atlamada bitmedi');
  if (atlama > 0) notlar.push('Açılış adresi ' + atlama + ' yönlendirme sonrası açılıyor: TWA her atlamayı ağ isteği olarak yapar, zayıf bağlantıda ilk açılış bu yüzden düşebilir.');

  /* ---- 2. Service worker ---- */
  console.log('');
  console.log('2. Service worker');
  const swAdaylari = ['/flutter_service_worker.js', '/sw.js', '/service-worker.js', '/firebase-messaging-sw.js'];
  const bulunanSw = [];
  for (const yol of swAdaylari) {
    const y = await iste(HOST + yol);
    if (!y.hata && y.durum === 200 && /javascript/i.test(String(y.basliklar['content-type'] || ''))) {
      bulunanSw.push(yol);
      bilgi('var: ' + yol, (y.govde.length / 1024).toFixed(1) + ' KB');
    }
  }
  const kayitVar = /serviceWorker\s*\.\s*register|flutter_service_worker|serviceWorkerVersion/.test(sonGovde);
  if (!bulunanSw.length && !kayitVar) {
    ok('service worker yok', 'çevrimdışı önbellek bu arızanın sebebi OLAMAZ');
  } else {
    bilgi('sayfa service worker kaydediyor', kayitVar ? 'evet' : 'hayır');
    notlar.push('Service worker var (' + (bulunanSw.join(', ') || 'sayfa içinde kayıt') + '). '
      + 'TWA, telefondaki Chrome ile AYNI profil ve AYNI service worker kaydını kullanır: '
      + 'eski/bozuk bir önbellek girdisi uygulamada ağ hatası sayfası üretebilirken, '
      + 'Chrome sekmesinde yeniden yükleme (ağ öncelikli) çalışmaya devam eder. '
      + 'Flutter web\'in service worker\'ı sürüm uyuşmazlığında açılışı kilitler: '
      + 'flutter_service_worker.js?v=… sorgusu index.html\'deki serviceWorkerVersion ile aynı olmalı.');
  }

  /* ---- 3. assetlinks.json ---- */
  console.log('');
  console.log('3. /.well-known/assetlinks.json');
  const al = await iste(HOST + '/.well-known/assetlinks.json');
  if (al.hata) {
    hata('okunamadı', al.hata);
  } else {
    bekle(al.durum === 200, 'GET → ' + al.durum);
    const ct = String(al.basliklar['content-type'] || '');
    const htmlMi = /text\/html/i.test(ct) || /^\s*<(!doctype|html)/i.test(al.govde);
    if (htmlMi) {
      /* Firebase Hosting / SPA kurulumunda "**" → /index.html yeniden yazımı
         bu dosyayı da yakalar; Android doğrulayıcı JSON bekler, HTML alır. */
      hata('JSON değil, HTML dönüyor', 'SPA/Firebase "**" yeniden yazımı bu yolu yakalıyor');
      notlar.push('firebase.json içindeki rewrites "**" → /index.html kuralı '
        + '/.well-known/assetlinks.json isteğini de index.html\'e çeviriyor. '
        + 'Firebase Hosting\'de bu dosya public/.well-known/ altında DURMALI ve '
        + '"rewrites" ondan SONRA gelmeli (Hosting önce gerçek dosyaya bakar; '
        + 'dosya yoksa rewrite devreye girer).');
    } else {
      let j = null;
      try { j = JSON.parse(al.govde); } catch (e) { hata('JSON ayrıştırılamadı', e.message); }
      if (Array.isArray(j)) {
        ok('geçerli JSON dizisi', j.length + ' kayıt');
        const hedefler = j.map(function (k) { return (k && k.target) || {}; });
        const bizim = hedefler.filter(function (t) { return t.package_name === PAKET; });
        bekle(bizim.length > 0, 'paket adı ' + PAKET + ' listede',
          'listedekiler: ' + hedefler.map(function (t) { return t.package_name || '?'; }).join(', '));
        j.forEach(function (k) {
          const r = (k && k.relation) || [];
          bekle(r.indexOf('delegate_permission/common.handle_all_urls') !== -1,
            'relation handle_all_urls', JSON.stringify(r));
        });
        bizim.forEach(function (t) {
          const fp = (t.sha256_cert_fingerprints || []);
          bekle(fp.length > 0, 'parmak izi var');
          fp.forEach(function (f) {
            bekle(/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/.test(String(f).toUpperCase()),
              'parmak izi biçimi (32 bayt, iki nokta ayraçlı)', String(f).slice(0, 24) + '…');
          });
          if (fp.length === 1) {
            notlar.push('assetlinks\'te TEK parmak izi var. Play App Signing kullanılıyorsa '
              + 'iki ayrı anahtar vardır: YÜKLEME anahtarı (yerelde imzaladığınız) ve '
              + 'UYGULAMA İMZALAMA anahtarı (Play\'in yeniden imzaladığı). Play\'den inen '
              + 'sürüm ikincisiyle imzalıdır; dahili testte "yerelde kurduğumda çalışıyor, '
              + 'Play\'den inince çalışmıyor" ayrımı buradan gelir. İkisini de listeye koyun.');
          }
        });
      }
    }
  }

  /* ---- 4. Google'ın doğrulayıcısı ---- */
  console.log('');
  console.log('4. Google Digital Asset Links doğrulayıcısı (kesin yanıt)');
  const api = 'https://digitalassetlinks.googleapis.com/v1/statements:list'
    + '?source.web.site=' + encodeURIComponent(HOST)
    + '&relation=' + encodeURIComponent('delegate_permission/common.handle_all_urls');
  const dal = await iste(api);
  if (dal.hata) {
    hata('doğrulayıcıya ulaşılamadı', dal.hata);
  } else if (dal.durum !== 200) {
    hata('doğrulayıcı ' + dal.durum, dal.govde.slice(0, 200));
  } else {
    let j = null;
    try { j = JSON.parse(dal.govde); } catch (e) { j = null; }
    const ifadeler = (j && j.statements) || [];
    const paketler = ifadeler.map(function (s) {
      return ((s.target || {}).androidApp || {}).packageName;
    }).filter(Boolean);
    bekle(paketler.indexOf(PAKET) !== -1, 'Google ' + PAKET + ' için bağ görüyor',
      paketler.length ? 'gördüğü paketler: ' + paketler.join(', ') : 'hiç bağ yok');
    if (j && j.debugString) bilgi('doğrulayıcı notu', String(j.debugString).slice(0, 300).replace(/\s+/g, ' '));
  }

  /* ---- 5. Web manifest ---- */
  console.log('');
  console.log('5. Web manifest');
  const mEsle = /<link[^>]+rel=["']manifest["'][^>]+href=["']([^"']+)["']/i.exec(sonGovde)
    || /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']manifest["']/i.exec(sonGovde);
  bekle(!!mEsle, 'sayfada <link rel="manifest">', 'yoksa Chrome uygulamayı kurulabilir saymaz');
  const mYol = mEsle ? new URL(mEsle[1], HOST + '/').toString() : HOST + '/manifest.json';
  const mm = await iste(mYol);
  if (mm.hata || mm.durum !== 200) {
    hata('manifest okunamadı', mYol + ' → ' + (mm.hata || mm.durum));
  } else {
    let m = null;
    try { m = JSON.parse(mm.govde); } catch (e) { hata('manifest JSON değil', String(mm.basliklar['content-type'])); }
    if (m) {
      ok('manifest okundu', mYol);
      bilgi('name / short_name', String(m.name) + ' / ' + String(m.short_name));
      bilgi('display', String(m.display));
      const su = new URL(m.start_url || '/', mYol).toString();
      bekle(ayniKaynak(su, HOST + '/'), 'start_url aynı kaynakta: ' + su);
      const sy = await iste(su);
      bekle(!sy.hata && sy.durum === 200, 'start_url açılıyor', su + ' → ' + (sy.hata || sy.durum));
      bekle(m.display === 'standalone' || m.display === 'fullscreen',
        'display standalone/fullscreen: ' + String(m.display));
      const bs = (m.icons || []).map(function (i) { return i.sizes; });
      bekle(bs.indexOf('192x192') !== -1 && bs.indexOf('512x512') !== -1,
        '192 ve 512 ikon (' + bs.join(' ') + ')');
    }
  }

  /* ---- 6. Flutter web derlemesi tamam mı ---- */
  console.log('');
  console.log('6. Flutter web derlemesi');
  const flutterIzi = /flutter_bootstrap\.js|main\.dart\.js|flutterConfiguration|_flutter/.test(sonGovde)
    || bulunanSw.indexOf('/flutter_service_worker.js') !== -1;
  if (!flutterIzi) {
    ok('sayfa Flutter değil', 'bu bölüm atlandı');
  } else {
    /* Flutter web'de sayfa boş bir kabuk: gövde JS gelmezse ekranda hiçbir şey
       olmaz ya da ağ hatası görünür. Bu yüzden varlıkların TEK TEK durumu
       ölçülüyor; "index.html 200 döndü" Flutter'da açıldı anlamına gelmiyor. */
    const bekleyen = ['/flutter_bootstrap.js', '/main.dart.js', '/flutter.js', '/version.json', '/assets/AssetManifest.json'];
    const durumlar = {};
    for (const yol of bekleyen) {
      const y = await iste(HOST + yol);
      durumlar[yol] = y.hata ? y.hata : y.durum;
      const boy = y.govde ? (y.govde.length / 1024).toFixed(1) + ' KB' : '—';
      bilgi(yol, String(durumlar[yol]) + ' · ' + boy);
    }
    const girisVar = durumlar['/flutter_bootstrap.js'] === 200 || durumlar['/main.dart.js'] === 200;
    bekle(girisVar, 'uygulama gövdesi sunuluyor (flutter_bootstrap.js veya main.dart.js)',
      'kabuk HTML 200 dönüyor ama uygulama kodu yok: ekranda boş sayfa ya da hata');

    const bas = /<base[^>]+href=["']([^"']+)["']/i.exec(sonGovde);
    bilgi('<base href>', bas ? bas[1] : '—');
    if (bas) bekle(bas[1] === '/' || bas[1] === './', '<base href> kökte', bas[1]);

    const swv = /serviceWorkerVersion["']?\s*[:=]\s*["']?([\w.-]+)/.exec(sonGovde);
    bilgi('index.html serviceWorkerVersion', swv ? swv[1] : 'yok');

    if (bulunanSw.indexOf('/flutter_service_worker.js') !== -1) {
      const sw = await iste(HOST + '/flutter_service_worker.js');
      const kaynakHaritasi = /RESOURCES\s*=|CORE\s*=/.test(sw.govde || '');
      bekle(kaynakHaritasi, 'flutter_service_worker.js gerçek Flutter service worker\'ı',
        'RESOURCES/CORE listesi yok (' + ((sw.govde || '').length) + ' bayt): '
        + 'ya elle yazılmış bir taslak ya da eksik derleme — önbellek listesi olmayan '
        + 'bir service worker isteği karşılamaya çalışıp açılışı kilitleyebilir');
    }
  }

  console.log('');
  if (notlar.length) {
    console.log('NOTLAR');
    notlar.forEach(function (n, i) { console.log('  ' + (i + 1) + ') ' + n.replace(/\s+/g, ' ')); });
    console.log('');
  }
  if (kaldi) { console.log('KALDI: ' + kaldi); process.exit(1); }
  console.log('TAMAM');
}

main().catch(function (e) { console.error('ÖLÇÜLEMEDİ: ' + (e && e.message)); process.exit(2); });
