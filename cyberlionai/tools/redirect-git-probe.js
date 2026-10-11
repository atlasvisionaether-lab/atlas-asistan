'use strict';

/**
 * Open redirect ve .git ifşası ölçümü.
 *
 *   node cyberlionai/tools/redirect-git-probe.js [adres ...]
 *
 * NEDEN VAR
 *
 * Yol haritasının son maddesi "open redirect + .git ifşası". Kontrol
 * yazmadan önce kaynaktan iki şey okundu:
 *
 *   1. `.git/HEAD` ZATEN VAR (`_lib/owasp.js` → SENSITIVE_PATHS, kimlik
 *      `a01___git_HEAD`). Üretim taramasında SKIP görünmesinin sebebi bir
 *      eksik değil, bilinçli bir kapı: aktif yollar yalnızca
 *      `consent === true && verified === true` iken deneniyor
 *      (`_lib/scan-levels.js` activeAllowed). Sahipliği doğrulanmamış
 *      anonim bir taramada not `requires_verified_ownership` oluyor.
 *      Yani eklenecek bir tespit YOK; ölçülecek olan şey, bu kapı
 *      açıldığında ölçümün gerçekten işe yarayıp yaramadığı.
 *
 *   2. Open redirect kontrolü HİÇ YOK. Depoda ne `open_redirect` kimliği
 *      ne de `next/url/redirect` parametresine dokunan bir kod var.
 *
 * Bu betik üç soruyu ölçüyor, çünkü üçü de kontrolün yazılıp
 * yazılmayacağına karar veriyor:
 *
 *   A. Statik bir sitede `?next=` gibi bir parametre yönlendirme üretir mi?
 *      Üretmiyorsa, "open redirect yok" demek bir ÖLÇÜM değil, sitenin
 *      sunucu tarafı olmamasının sonucudur — ve o zaman kontrol her statik
 *      sitede sessizce "geçti" der, hiçbir şey söylemez.
 *
 *   B. Ölçüt ne olmalı? Yanıtın 30x olması YETMEZ: 301 ile kendi içine
 *      yönlendiren bir site (apex → www) de 30x döndürür. Tek anlamlı
 *      ölçüt, `Location` başlığının BAŞKA BİR ANA BİLGİSAYARA işaret
 *      etmesi. Bu yüzden Location olduğu gibi basılıyor.
 *
 *   C. `.git/HEAD` ölçümü, kapı açıkken ne dönüyor? Sunucu 404 mü, 200 +
 *      HTML mi (SPA yakalaması), yoksa gerçekten dosya mı veriyor?
 *
 * SINIRLAR
 *
 * - Yalnızca KENDİ alan adlarımız. Üçüncü taraf bir siteye yönlendirme
 *   denemesi göndermek bu projede açık onay gerektirir.
 * - Payload yok, veri yazmıyor, oturum açmıyor: yalnızca GET + yönlendirme
 *   TAKİP EDİLMEDEN başlık okuma.
 * - Elle, bir kez. Hiçbir zamanlamaya bağlı değil.
 */

const ZAMAN_ASIMI = 8000;
const UA = 'CyberLionAI-Probe/1.0 (+https://cyberlionai.com)';

const KALIN = '\x1b[1m';
const SIFIRLA = '\x1b[0m';

/* Yaygın yönlendirme parametreleri. Hedef olarak example.com kullanılıyor:
   RFC 2606 ile bu iş için ayrılmış bir ad, yani kimsenin sunucusuna istek
   gitmiyor — yönlendirme OLUŞSAYDI bile takip edilmiyor. */
const PARAMETRELER = ['next', 'url', 'redirect', 'return', 'returnUrl', 'r', 'dest', 'continue'];
const HEDEF = 'https://example.com/cyberlion-redirect-probe';

function yaz(etiket, deger) {
  process.stdout.write('   ' + String(etiket).padEnd(26) + String(deger) + '\n');
}

async function istek(url) {
  const kontrolcu = new AbortController();
  const zamanlayici = setTimeout(function () { kontrolcu.abort(); }, ZAMAN_ASIMI);
  try {
    /* redirect: 'manual' — yönlendirme TAKİP EDİLMİYOR. Hem ölçümün kendisi
       Location başlığı, hem de takip etmek üçüncü bir adrese istek atmak
       olurdu. */
    const y = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: kontrolcu.signal,
      headers: { 'User-Agent': UA, 'Accept': '*/*' }
    });
    clearTimeout(zamanlayici);
    return {
      ok: true,
      status: y.status,
      location: y.headers.get('location'),
      contentType: y.headers.get('content-type')
    };
  } catch (e) {
    clearTimeout(zamanlayici);
    return { ok: false, hata: e && e.name === 'AbortError' ? 'timeout' : (e.message || 'error') };
  }
}

/**
 * Yönlendirme GERÇEKTEN payload'ın hedefine mi gidiyor?
 *
 * İLK SÜRÜM YANLIŞTI ve ölçüm bunu yakaladı (koşu 38180366491): ölçüt
 * "Location host'u taban host'undan FARKLI" idi ve apex → www yönlendirmesini
 * (308 → https://www.cyberlionai.com/?next=...) açık sandı. Oysa orada
 * example.com yalnızca SORGU DİZESİNİN İÇİNDE taşınıyordu; yönlendirme kendi
 * sitemize gidiyordu. 16 satır yanlış pozitif üretti.
 *
 * Doğru ölçüt: Location'ın HOST'U payload'ın host'una eşit mi. Sorgu dizesinde
 * geçmesi bir kanıt DEĞİL — sunucu parametreyi yalnızca taşıyor demektir.
 */
function hedefeMiGidiyor(location, taban) {
  if (!location) return false;
  try {
    const hedef = new URL(location, taban);
    return hedef.host === new URL(HEDEF).host;
  } catch (e) {
    return false;   /* ayrıştırılamayan Location bir yönlendirme kanıtı değil */
  }
}

/** Aynı site mi (apex ↔ www)? Bilgi amaçlı; açık DEĞİL. */
function ayniSite(location, taban) {
  if (!location) return false;
  try {
    const a = new URL(location, taban).host.replace(/^www\./, '');
    const b = new URL(taban).host.replace(/^www\./, '');
    return a === b;
  } catch (e) {
    return false;
  }
}

async function olc(taban) {
  process.stdout.write('\n' + KALIN + '== ' + taban + SIFIRLA + '\n');

  /* --- A/B: open redirect --- */
  const temel = await istek(taban);
  yaz('taban GET', temel.ok
    ? temel.status + (temel.location ? '  → ' + temel.location : '')
    : 'ÖLÇÜLEMEDİ (' + temel.hata + ')');

  for (const p of PARAMETRELER) {
    const url = taban + (taban.indexOf('?') === -1 ? '?' : '&') + p + '=' + encodeURIComponent(HEDEF);
    const y = await istek(url);
    if (!y.ok) { yaz('?' + p, 'ÖLÇÜLEMEDİ (' + y.hata + ')'); continue; }
    const acik = hedefeMiGidiyor(y.location, taban);
    const ayni = ayniSite(y.location, taban);
    yaz('?' + p, y.status
      + (y.location ? '  Location: ' + y.location : '  (Location yok)')
      + (acik ? '   ** AÇIK YÖNLENDİRME **' : '')
      + (!acik && y.location && ayni ? '   (aynı site — açık değil)' : ''));
  }

  /* --- C: .git ifşası --- */
  for (const yol of ['/.git/HEAD', '/.git/config', '/.env']) {
    const y = await istek(taban.replace(/\/$/, '') + yol);
    yaz(yol, y.ok
      ? y.status + '  ' + (y.contentType || '(içerik tipi yok)')
      : 'ÖLÇÜLEMEDİ (' + y.hata + ')');
  }
}

(async function () {
  /* YALNIZCA kendi alan adlarımız. Üçüncü taraf bir siteye yönlendirme
     denemesi göndermek açık onay gerektirir (bkz. .claude/skills). */
  const liste = process.argv.slice(2).length ? process.argv.slice(2) : [
    'https://www.cyberlionai.com/',
    'https://cyberlionai.com/',
    'https://cyberlionai.vercel.app/',
    'https://www.atlasasistan.com/'
  ];

  process.stdout.write(KALIN + 'Open redirect ve .git ifşası ölçümü' + SIFIRLA + '\n');
  process.stdout.write('Node: ' + process.version + '\n');
  process.stdout.write('Yönlendirme hedefi: ' + HEDEF + '  (RFC 2606, takip EDİLMİYOR)\n');

  for (const t of liste) {
    try { await olc(t); } catch (e) { process.stdout.write('   HATA ' + e.message + '\n'); }
  }

  process.stdout.write('\n' + KALIN + 'Okunacak sorular' + SIFIRLA + '\n');
  process.stdout.write('1. Hiçbir parametre "** AÇIK YÖNLENDİRME **" üretmediyse: bu site statik ve\n');
  process.stdout.write('   bir open redirect kontrolü burada her zaman "geçti" der. O zaman\n');
  process.stdout.write('   kontrol bir şey ÖLÇMÜYOR, yalnızca rapora satır ekliyor demektir.\n');
  process.stdout.write('2. 30x gören her yer açık DEĞİL: apex -> www de 308 verir ve\n');
  process.stdout.write('   parametreyi sorgu dizesinde TAŞIR. Ölçüt, Location HOST\'unun\n');
  process.stdout.write('   payload hedefine (example.com) eşit olması — farklı olması değil.\n');
  process.stdout.write('   (İlk sürüm bunu yanlış kurdu ve 16 yanlış pozitif üretti.)\n');
  process.stdout.write('3. .git/HEAD 200 + text/html dönüyorsa bu SPA yakalamasıdır, ifşa\n');
  process.stdout.write('   değil — owasp.js bu ayrımı zaten yapıyor (içerik tipi HTML ise geçti).\n');
})();
