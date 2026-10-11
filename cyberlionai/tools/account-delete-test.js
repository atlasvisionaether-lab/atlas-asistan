'use strict';

/**
 * Hesap silme yolu: uç + kapsam + arayüz + katalog. Ağ gerektirmez.
 *
 *   node tools/account-delete-test.js
 *
 * NEDEN VAR
 *
 * Google Play, hesap açtıran bir uygulamanın hesap ve veri silmeyi hem
 * uygulama içinden hem HERKESE AÇIK bir web adresinden sunmasını şart
 * koşuyor; KVKK'nın silme talebi de aynı şeyi istiyor. Depoda bu yol HİÇ
 * YOKTU: `/api/history` yalnızca tarama kayıtlarını siliyordu.
 *
 * Ama bu sınamanın asıl sebebi ÖLÇÜLEN bir tuzak (11.10.2026, db/*.sql):
 * yabancı anahtarlar TEK TİP DEĞİL.
 *
 *   cl_scans · cl_subscriptions · cl_device_tokens
 *   verified_domains · monitor_alerts      → ON DELETE CASCADE
 *   scan_jobs · scan_logs · fix_orders     → ON DELETE SET NULL
 *   cl_waitlist                            → user_id sütunu YOK
 *
 * Yani "auth.users satırını sil, kısıtlar gerisini halleder" YANLIŞ: bu
 * yolda `scan_jobs` satırları silinmez, kullanıcı kimliği NULL'a çekilir ve
 * taranan alan adları + bulgular + AI raporları SAHİPSİZ satırlar olarak
 * tabloda kalır. Üstelik sahipsiz kaldıktan sonra artık silinemezler.
 *
 * Burada kilitlenenler:
 *
 *   1. `auth.users`'a bağlı HER tablo (göç dosyalarından OKUNUYOR, elle
 *      tutulan listeden değil) ya siliniyor ya gerekçeli anonimleştiriliyor.
 *   2. Sıra: veri önce, hesap sonra. Tersi geri alınamaz.
 *   3. Yetki: oturum zorunlu, kimlik gövdeden değil oturumdan.
 *   4. Arayüz: panel düğmesi + onay metni + herkese açık /hesap-silme sayfası,
 *      üçü de aynı uca gidiyor ve aynı onay dizgesini gönderiyor.
 *   5. Katalog ve gizlilik politikası silme yolunu yazıyor (Play formu
 *      "Data deletion URL" istiyor; politika ile form ayrışırsa uygulama
 *      reddedilir).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const YESIL = '\x1b[32m';
const KIRMIZI = '\x1b[31m';
const KALIN = '\x1b[1m';
const SIFIRLA = '\x1b[0m';

const KOK = path.join(__dirname, '..');
const oku = function (p) { return fs.readFileSync(path.join(KOK, p), 'utf8'); };

let gecti = 0;
let kalan = 0;
function dene(ad, fn) {
  try {
    fn();
    gecti++;
    process.stdout.write('  ' + YESIL + 'GEÇTİ' + SIFIRLA + '  ' + ad + '\n');
  } catch (e) {
    kalan++;
    process.stdout.write('  ' + KIRMIZI + 'KALDI' + SIFIRLA + '  ' + ad + ' — ' + e.message + '\n');
  }
}
async function deneAsync(ad, fn) {
  try {
    await fn();
    gecti++;
    process.stdout.write('  ' + YESIL + 'GEÇTİ' + SIFIRLA + '  ' + ad + '\n');
  } catch (e) {
    kalan++;
    process.stdout.write('  ' + KIRMIZI + 'KALDI' + SIFIRLA + '  ' + ad + ' — ' + e.message + '\n');
  }
}

/* Sahte istek/yanıt: handler GERÇEKTEN çağrılıyor. Metin eşleştiren sınamalar
   eksik bir `require` satırını yakalamıyor (bkz. scanhandler-test.js dersi). */
function sahteYanit() {
  const y = {
    kod: 0, govde: null, basliklar: {},
    setHeader: function (k, v) { y.basliklar[String(k).toLowerCase()] = v; },
    getHeader: function (k) { return y.basliklar[String(k).toLowerCase()]; },
    status: function (k) { y.kod = k; return y; },
    json: function (g) { y.govde = g; return y; }
  };
  return y;
}
function sahteIstek(method, body, headers) {
  return { method: method, body: body || null, headers: headers || {} };
}

const ACCOUNT = oku('api/panel/account.js');
const DB = oku('api/_lib/db.js');
const AUTH = oku('api/_lib/auth.js');

(async function () {

/* ------------------------------------------------------------ 1. Uç davranışı */
process.stdout.write(KALIN + 'Uç gerçekten çağrılıyor ve kapıları tutuyor' + SIFIRLA + '\n');

const handler = require(path.join(KOK, 'api', 'panel', 'account.js'));

dene('uç bir handler fonksiyonu dışa veriyor', function () {
  assert.strictEqual(typeof handler, 'function');
});

await deneAsync('GET → 405 ve Allow: DELETE', async function () {
  const res = sahteYanit();
  await handler(sahteIstek('GET'), res);
  assert.strictEqual(res.kod, 405);
  assert.strictEqual(res.basliklar.allow, 'DELETE');
  assert.strictEqual(res.govde.error.code, 'method_not_allowed');
});

await deneAsync('POST da 405 — silme yalnızca DELETE ile', async function () {
  const res = sahteYanit();
  await handler(sahteIstek('POST', { confirm: 'HESABIMI SIL' }), res);
  assert.strictEqual(res.kod, 405);
});

await deneAsync('kişiye özel yanıt önbelleğe alınmıyor (Cache-Control: no-store)', async function () {
  const res = sahteYanit();
  await handler(sahteIstek('GET'), res);
  assert.strictEqual(res.basliklar['cache-control'], 'no-store');
});

await deneAsync('yapılandırma eksikse 503 — yarım silme yok', async function () {
  const saklanan = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const res = sahteYanit();
    await handler(sahteIstek('DELETE', { confirm: 'HESABIMI SIL' }), res);
    assert.strictEqual(res.kod, 503);
    assert.strictEqual(res.govde.error.code, 'account_delete_unavailable');
  } finally {
    Object.keys(saklanan).forEach(function (k) {
      if (saklanan[k] === undefined) delete process.env[k]; else process.env[k] = saklanan[k];
    });
  }
});

await deneAsync('oturum yoksa 401 — anonim istek hiçbir şey silemez', async function () {
  /* Çerez de Bearer de yok: resolveUser ağa ÇIKMADAN null döner. */
  const saklanan = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  process.env.SUPABASE_URL = 'https://ornek.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-anahtar-yer-tutucu';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'servis-anahtari-yer-tutucu';
  try {
    const res = sahteYanit();
    await handler(sahteIstek('DELETE', { confirm: 'HESABIMI SIL' }, {}), res);
    assert.strictEqual(res.kod, 401, 'beklenen 401, gelen ' + res.kod);
    assert.strictEqual(res.govde.error.code, 'auth_required');
  } finally {
    Object.keys(saklanan).forEach(function (k) {
      if (saklanan[k] === undefined) delete process.env[k]; else process.env[k] = saklanan[k];
    });
  }
});

dene('silinecek kimlik GÖVDEDEN okunmuyor', function () {
  /* Gövdeden yalnızca `confirm` okunuyor. Bir `user_id` ya da `email` alanı
     okunursa başka bir hesabı silmeye çalışan istek yazılabilir hâle gelir. */
  assert.ok(/body\.confirm/.test(ACCOUNT), 'gövdeden confirm okunmuyor');
  assert.ok(!/body\.(user_?id|userId|email)/i.test(ACCOUNT),
    'gövdeden kimlik okunuyor — hesap yalnızca OTURUMDAN çözülmeli');
  assert.ok(/deleteAccountData\(user\.id/.test(ACCOUNT), 'silme çözülen oturumun kimliğiyle çağrılmıyor');
});

dene('onay dizgesi şart (kazara silmeye karşı)', function () {
  assert.ok(/confirmation_required/.test(ACCOUNT), 'onay yoksa hata kodu yok');
});

/* --------------------------------------------- 2. Kapsam: göç dosyalarından */
process.stdout.write(KALIN + 'auth.users’a bağlı her tablo ya siliniyor ya gerekçeli kalıyor' + SIFIRLA + '\n');

/** db/ ve db/migrations/ altındaki tüm .sql dosyaları. */
function sqlDosyalari(dizin) {
  return fs.readdirSync(dizin, { withFileTypes: true }).reduce(function (acc, e) {
    const tam = path.join(dizin, e.name);
    if (e.isDirectory()) return acc.concat(sqlDosyalari(tam));
    return /\.sql$/.test(e.name) ? acc.concat(tam) : acc;
  }, []);
}

/* `create table ... (` bloğunu ayırıp içinde auth.users'a bağlı bir `user_id`
   var mı diye bakıyor. Tablo listesi ELLE TUTULMUYOR: yeni bir göç dosyası
   hesaba bağlı bir tablo eklerse bu sınama onu kendiliğinden görür ve
   silme listesine eklenmediyse kalır. */
const KULLANICI_TABLOLARI = [];
sqlDosyalari(path.join(KOK, 'db')).forEach(function (f) {
  const metin = fs.readFileSync(f, 'utf8');
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_]+)\s*\(([\s\S]*?)\n\s*\);/gi;
  let m;
  while ((m = re.exec(metin)) !== null) {
    const ad = m[1];
    const govde = m[2];
    if (/user_id[\s\S]*?references\s+auth\.users/i.test(govde)) {
      if (KULLANICI_TABLOLARI.indexOf(ad) === -1) KULLANICI_TABLOLARI.push(ad);
    }
  }
});
/* cl_scans'in kısıtı ayrı bir göçle (004) ALTER TABLE ile eklendi. */
sqlDosyalari(path.join(KOK, 'db')).forEach(function (f) {
  const metin = fs.readFileSync(f, 'utf8');
  const re = /alter\s+table\s+(?:public\.)?([a-z_]+)[\s\S]*?foreign\s+key\s*\(\s*user_id\s*\)[\s\S]*?references\s+auth\.users/gi;
  let m;
  while ((m = re.exec(metin)) !== null) {
    if (KULLANICI_TABLOLARI.indexOf(m[1]) === -1) KULLANICI_TABLOLARI.push(m[1]);
  }
});

dene('göç dosyalarından en az altı kullanıcı tablosu okundu (okuma çalışıyor)', function () {
  assert.ok(KULLANICI_TABLOLARI.length >= 6,
    'yalnızca ' + KULLANICI_TABLOLARI.length + ' tablo okundu: ' + KULLANICI_TABLOLARI.join(', '));
});

const SILME_BOLUMU = DB.slice(DB.indexOf('HESAP SİLME'));
dene('silme bölümü db.js içinde bulundu', function () {
  assert.ok(SILME_BOLUMU && /deleteAccountData/.test(SILME_BOLUMU), 'deleteAccountData bulunamadı');
});

KULLANICI_TABLOLARI.forEach(function (tablo) {
  dene('"' + tablo + '" silme yolunda geçiyor', function () {
    assert.ok(SILME_BOLUMU.indexOf("'" + tablo + "'") !== -1 || (tablo === 'cl_scans' && /\[TABLE,/.test(SILME_BOLUMU)),
      'hesaba bağlı bir tablo ama silme ya da anonimleştirme listesinde yok — ' +
      'hesap silindiğinde satırları SAHİPSİZ kalır');
  });
});

dene('scan_jobs AÇIKÇA siliniyor (cascade’e güvenilmiyor)', function () {
  /* Ölçüm: scan_jobs.user_id kısıtı `on delete set null`. */
  assert.ok(/\['scan_jobs', kullanici\]/.test(SILME_BOLUMU), 'scan_jobs silme listesinde değil');
  assert.ok(/set\s+null/i.test(SILME_BOLUMU), 'kısıtın SET NULL olduğu gerekçesi yazılı değil');
});

dene('yasal kayıtlar silinmiyor, anonimleştiriliyor (gerekçeli)', function () {
  assert.ok(/ANONIMLESTIRILEN = \['scan_logs', 'fix_orders'\]/.test(SILME_BOLUMU),
    'anonimleştirilen tablolar listesi değişmiş');
  assert.ok(/user_id: null/.test(SILME_BOLUMU), 'kişiyle bağ kesilmiyor');
  assert.ok(/hukuki ispat/i.test(SILME_BOLUMU) && /vergi|fatura/i.test(SILME_BOLUMU),
    'neden saklandığı yazılı değil');
});

dene('cl_waitlist e-posta ile siliniyor (user_id sütunu yok)', function () {
  assert.ok(/cl_waitlist', 'email=eq\./.test(SILME_BOLUMU), 'bekleme listesi e-posta ile silinmiyor');
});

dene('eksik göç (PostgREST 404) silmeyi durdurmuyor ama sessiz de kalmıyor', function () {
  assert.ok(/db_error_404/.test(SILME_BOLUMU), '404 ayrı ele alınmıyor');
  assert.ok(/atlanan/.test(SILME_BOLUMU) && /skipped/.test(ACCOUNT),
    'atlanan tablo çağırana bildirilmiyor');
});

dene('sıra: veri önce, hesap sonra', function () {
  const veri = ACCOUNT.indexOf('deleteAccountData');
  const hesap = ACCOUNT.indexOf('adminDeleteUser');
  assert.ok(veri !== -1 && hesap !== -1, 'iki çağrıdan biri yok');
  assert.ok(veri < hesap,
    'hesap önce silinirse scan_jobs satırları SAHİPSİZ kalır ve bir daha silinemez');
});

dene('hesap satırı servis rolüyle siliniyor, anon anahtarla değil', function () {
  const bolum = AUTH.slice(AUTH.indexOf('function adminConfig'));
  assert.ok(/SUPABASE_SERVICE_ROLE_KEY/.test(bolum), 'servis rolü anahtarı kullanılmıyor');
  assert.ok(/admin\/users\//.test(bolum), 'GoTrue yönetici ucu çağrılmıyor');
  assert.ok(/UUID_RE\.test/.test(bolum), 'kimlik biçimi sınanmıyor');
});

dene('silme başarısızsa hesap kapalı sanılmıyor (kısmi durum kodu var)', function () {
  assert.ok(/account_delete_partial/.test(ACCOUNT), 'kısmi silme durumu bildirilmiyor');
});

dene('oturum çerezleri silme sonrası temizleniyor', function () {
  assert.ok(/clearSessionCookies/.test(ACCOUNT), 'hesap yok ama çerez elde kalıyor');
});

dene('denetim izinde e-posta maskeli, silinen verinin kendisi gitmiyor', function () {
  assert.ok(/hesapSilindi/.test(ACCOUNT), 'Telegram denetim izi yok');
  const tgKaynak = oku('api/_lib/telegram.js');
  const fn = tgKaynak.slice(tgKaynak.indexOf('hesapSilindi:'), tgKaynak.indexOf('hesapSilindi:') + 600);
  assert.ok(/maskEmail\(eposta\)/.test(fn), 'e-posta maskelenmeden gönderiliyor');
  assert.ok(!/domain|host|alan\(/.test(fn), 'bildirimde alan adı taşınıyor');
});

/* ------------------------------------------------------------- 3. Arayüz */
process.stdout.write(KALIN + 'Panel düğmesi, onay metni ve herkese açık sayfa' + SIFIRLA + '\n');

const DASH_HTML = oku('dashboard.html');
const DASH_JS = oku('dashboard.js');
const SAYFA = oku('pages/hesap-silme.html');
const SAYFA_JS = oku('hesap-silme.js');

dene('panelde silme düğmesi ve onay penceresi var', function () {
  ['delBtn', 'delModal', 'delYes', 'delNo', 'delMsg'].forEach(function (id) {
    assert.ok(DASH_HTML.indexOf('id="' + id + '"') !== -1, id + ' yok');
  });
  assert.ok(/bindDelete\(\)/.test(DASH_JS), 'bindDelete çağrılmıyor');
});

dene('onay metni kullanıcıya NE kaybedeceğini söylüyor', function () {
  const beklenen = 'Tüm tarama geçmişiniz ve aboneliğiniz silinecek';
  assert.ok(DASH_HTML.indexOf(beklenen) !== -1, 'dashboard.html’de onay metni yok');
  assert.ok(DASH_JS.indexOf(beklenen) !== -1, 'dashboard.js TR sözlüğünde onay metni yok');
});

dene('silme metinleri iki dilde de tam', function () {
  const anahtarlar = (DASH_JS.match(/'del\.[a-zA-Z]+'/g) || []);
  const tekil = Array.from(new Set(anahtarlar));
  assert.ok(tekil.length >= 8, 'yalnızca ' + tekil.length + ' del.* anahtarı var');
  tekil.forEach(function (a) {
    const sayi = anahtarlar.filter(function (x) { return x === a; }).length;
    assert.strictEqual(sayi, 2, a + ' iki dilde değil (' + sayi + ' kez geçiyor)');
  });
});

dene('HTML’deki her data-i18n="del.*" anahtarı sözlükte var', function () {
  const kullanilan = Array.from(new Set((DASH_HTML.match(/data-i18n="(del\.[a-zA-Z]+)"/g) || [])
    .map(function (x) { return /data-i18n="([^"]+)"/.exec(x)[1]; })));
  assert.ok(kullanilan.length >= 6, 'HTML’de yalnızca ' + kullanilan.length + ' del.* anahtarı var');
  kullanilan.forEach(function (a) {
    assert.ok(DASH_JS.indexOf("'" + a + "'") !== -1, a + ' sözlükte yok — ekranda boş görünür');
  });
});

dene('herkese açık /hesap-silme sayfası var ve iki dilli', function () {
  assert.ok(/data-lang-block="tr"/.test(SAYFA) && /data-lang-block="en"/.test(SAYFA),
    'iki dil bloğundan biri yok');
  assert.ok(/id="delBtn"/.test(SAYFA) && /id="delBtnEn"/.test(SAYFA), 'silme düğmesi yok');
  assert.ok(/hesap-silme\.js/.test(SAYFA), 'sayfa betiği bağlı değil');
});

dene('sayfa ne silindiğini ve ne kaldığını yazıyor', function () {
  assert.ok(/geri alınamaz/i.test(SAYFA), 'geri alınamazlık yazılı değil');
  assert.ok(/hukuki ispat/i.test(SAYFA) && /iyzico/i.test(SAYFA),
    'saklanan kayıtların gerekçesi yazılı değil');
});

dene('üç arayüz de AYNI uca ve AYNI onay dizgesine gidiyor', function () {
  [['dashboard.js', DASH_JS], ['hesap-silme.js', SAYFA_JS]].forEach(function (p) {
    assert.ok(p[1].indexOf("'/api/panel/account'") !== -1, p[0] + ' başka bir uca gidiyor');
    assert.ok(/confirm: 'HESABIMI SIL'/.test(p[1]), p[0] + ' onay dizgesini göndermiyor');
    assert.ok(/method: 'DELETE'/.test(p[1]), p[0] + ' DELETE kullanmıyor');
  });
  /* Sunucu bu dizgeyi kabul ediyor mu? */
  assert.ok(/'HESABIMI SIL'/.test(ACCOUNT), 'sunucu bu onay dizgesini tanımıyor');
});

dene('sayfa betiğinde kimlik ya da belirteç yok (oturum HttpOnly çerezde)', function () {
  /* Yorumlar ÇIKARILIYOR: ilk sürüm "bu dosyada token yok" diye yazan
     YORUMU belirteç sandı ve doğru dosyayı kusurlu gösterdi. Sınanan şey
     kodun kendisi. */
  const kod = SAYFA_JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/Authorization|apikey|Bearer/i.test(kod), 'istemci betiğinde belirteç başlığı var');
  assert.ok(!/localStorage|sessionStorage/.test(kod), 'belirteç tarayıcı deposundan okunuyor');
  assert.ok(/credentials: 'same-origin'/.test(kod), 'oturum çerezi gönderilmiyor');
});

dene('/hesap-silme ve /delete-account bir dosyaya çıkıyor', function () {
  const vercel = JSON.parse(oku('vercel.json'));
  const yon = {};
  (vercel.redirects || []).forEach(function (r) { yon[r.source] = r.destination; });
  ['/hesap-silme', '/delete-account'].forEach(function (yol) {
    assert.ok(yon[yol], yol + ' yönlendirmesi yok — Play’in istediği adres 404 verir');
    const hedef = yon[yol];
    const dosya = /\.html$/.test(hedef) ? hedef : hedef + '.html';
    assert.ok(fs.existsSync(path.join(KOK, dosya.replace(/^\//, ''))), 'dosya yok: ' + dosya);
  });
});

/* ------------------------------------------- 4. Katalog ve gizlilik politikası */
process.stdout.write(KALIN + 'Katalog ve politika silme yolunu yazıyor' + SIFIRLA + '\n');

const katalog = JSON.parse(oku('legal/data-catalog.json'));
const politika = oku('legal/gizlilik-politikasi.md');

dene('katalogda hesapSilme bloğu var ve uç doğru', function () {
  const h = katalog.hesapSilme;
  assert.ok(h, 'hesapSilme bloğu yok');
  assert.strictEqual(h.uc, 'DELETE /api/panel/account');
  assert.ok(/hesap-silme/.test(h.webSayfasi), 'Play’e verilecek adres yazılı değil');
  assert.ok(fs.existsSync(path.join(KOK, 'api', 'panel', 'account.js')), 'uç dosyası yok');
});

dene('katalogdaki silinen tablolar kodda GERÇEKTEN siliniyor', function () {
  katalog.hesapSilme.silinenTablolar.forEach(function (tablo) {
    if (tablo === 'scan_findings' || tablo === 'ai_reports') {
      /* Bunlar scan_jobs’a `on delete cascade` ile bağlı; iş silinince gider. */
      assert.ok(/cascade/i.test(SILME_BOLUMU), tablo + ' için cascade gerekçesi yazılı değil');
      return;
    }
    assert.ok(SILME_BOLUMU.indexOf(tablo) !== -1 || (tablo === 'cl_scans' && /\[TABLE,/.test(SILME_BOLUMU)),
      'katalog siliyor diyor ama kodda yok: ' + tablo);
  });
});

dene('katalogdaki anonimleştirilen tablolar kodla aynı', function () {
  katalog.hesapSilme.anonimlestirilenTablolar.forEach(function (tablo) {
    assert.ok(SILME_BOLUMU.indexOf("'" + tablo + "'") !== -1, tablo + ' kodda anonimleştirilmiyor');
  });
});

dene('silinemez diyen her kalemin sebebi ve karşılığı var', function () {
  katalog.kalemler.filter(function (k) { return k.silinebilir === false; }).forEach(function (k) {
    assert.ok(k.silinemezSebep, k.id + ': sebep yok');
  });
});

dene('gizlilik politikası silme yolunu ve adresi yazıyor', function () {
  assert.ok(/Hesabınızı ve Verilerinizi Silme/.test(politika), 'politikada silme bölümü yok');
  assert.ok(/hesap-silme/.test(politika), 'politikada silme adresi yok');
  /* Üretilen HTML de bayat kalmasın (legal/*.md → kök HTML hattı). */
  const html = oku('gizlilik-politikasi.html');
  assert.ok(/hesap-silme/.test(html), 'üretilmiş HTML bayat — render-legal-md.js çalıştırılmalı');
});

process.stdout.write('\nGeçen: ' + gecti + '   Kalan: ' + kalan + '\n');
process.exit(kalan === 0 ? 0 : 1);

})();
