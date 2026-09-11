'use strict';

/**
 * Telegram entegrasyonu sınamaları.
 *
 *   node tools/telegram-test.js
 *
 * Ağa ÇIKMAZ. Telegram API'si sahte fetch ile yakalanır.
 *
 * En çok önemsenen iki şey:
 *   1. Maskeleme gerçekten maskeliyor mu — ham IP/e-posta çıktıya SIZMIYOR mu?
 *   2. Webhook'un üç güvenlik kapısı gerçekten kapalı mı?
 */

const path = require('path');
const tg = require('../api/_lib/telegram.js');
const store = require('../api/_lib/telegram-store.js');

let failed = 0;
function ok(c, m) {
  process.stdout.write((c ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + m + '\n');
  if (!c) failed = 1;
}
function head(t) { process.stdout.write('\n\x1b[1m== ' + t + '\x1b[0m\n'); }

/* ---------------- 1. Maskeleme ---------------- */
head('Maskeleme — ham değer ÇIKTIYA SIZMIYOR');

ok(tg.maskIp('88.120.35.17') === '88.120.x.x', 'IPv4 /16 seviyesinde maskeleniyor');
ok(tg.maskIp('88.120.35.17').indexOf('35') === -1, 'son iki sekizli çıktıda YOK');
ok(tg.maskIp('2a02:e0:1234:5::9') === '2a02:e0::x', 'IPv6 ilk iki öbekle sınırlı');
ok(tg.maskIp('999.1.1.1') === null, 'geçersiz IPv4 → null (ham değer dönmüyor)');
ok(tg.maskIp('rastgele metin') === null, 'IP olmayan girdi → null');
ok(tg.maskIp(null) === null && tg.maskIp('') === null, 'boş girdi → null');

ok(tg.maskEmail('kullanici@ornek.com') === 'ku***@ornek.com', 'e-posta yerel kısmı kırpılıyor');
ok(tg.maskEmail('kullanici@ornek.com').indexOf('llanici') === -1, 'yerel kısmın gerisi çıktıda YOK');
ok(tg.maskEmail('ab@x.co') === '***@x.co', 'kısa yerel kısım TAMAMEN gizleniyor');
ok(tg.maskEmail('bozuk') === null, 'geçersiz e-posta → null');

/* ---------------- 2. Kaçış ---------------- */
head('HTML kaçışı — biçim bozulmuyor, enjeksiyon geçmiyor');
ok(tg.esc('<b>x</b>') === '&lt;b&gt;x&lt;/b&gt;', 'etiketler kaçırılıyor');
ok(tg.esc('a & b') === 'a &amp; b', 'ampersand kaçırılıyor');
const zararli = tg.format('scan', 'TARAMA', [['Site', '<a href="x">evil</a>']]);
ok(zararli.indexOf('<a href') === -1, 'kullanıcı metnindeki etiket mesaja HAM girmiyor');
ok(zararli.indexOf('<b>') === 0 || zararli.indexOf('<b>') > -1, 'bizim biçimlendirmemiz duruyor');

head('Biçim — boş alan satır üretmiyor');
const bos = tg.format('scan', 'TARAMA', [['Var', 'x'], ['Yok', null], ['Bos', ''], ['Tanimsiz', undefined]]);
ok(bos.split('\n').length === 2, 'yalnızca dolu alan yazılıyor (satır: ' + bos.split('\n').length + ')');
ok(bos.indexOf('undefined') === -1 && bos.indexOf('null') === -1,
   '"undefined"/"null" kullanıcıya GÖSTERİLMİYOR');

/* ---------------- 3. Filtreler ---------------- */
head('Bildirim filtreleri');
const kapali = { enabled: false, notify_scans: true };
ok(store.allowed(kapali, 'scans', {}) === false, 'ana anahtar kapalıyken hiçbir şey geçmiyor');

const acik = { enabled: true, notify_scans: true, notify_visitors: false };
ok(store.allowed(acik, 'scans', {}) === true, 'açık tür geçiyor');
ok(store.allowed(acik, 'visitors', {}) === false, 'kapalı tür geçmiyor');
ok(store.allowed(acik, 'assistant', {}) === false, 'hiç tanımlanmamış tür geçmiyor');

const trOnly = { enabled: true, notify_scans: true, only_country: 'TR' };
ok(store.allowed(trOnly, 'scans', { country: 'TR' }) === true, 'ülke filtresi: TR geçiyor');
ok(store.allowed(trOnly, 'scans', { country: 'DE' }) === false, 'ülke filtresi: DE geçmiyor');

const kayitli = { enabled: true, notify_scans: true, only_registered: true };
ok(store.allowed(kayitli, 'scans', { registered: true }) === true, 'kayıtlı filtresi: kayıtlı geçiyor');
ok(store.allowed(kayitli, 'scans', { registered: false }) === false, 'kayıtlı filtresi: anonim geçmiyor');

const kritik = { enabled: true, notify_scans: true, only_critical: true };
ok(store.allowed(kritik, 'scans', { severity: 'info' }) === false, 'yalnızca kritik: info geçmiyor');
ok(store.allowed(kritik, 'scans', { severity: 'critical' }) === true, 'yalnızca kritik: critical geçiyor');

head('Güvenli varsayılan');
ok(store.KISISEL.length === 5, 'kişisel veri taşıyan beş tür tanımlı');
const varsayilan = { enabled: true };
ok(store.KISISEL.every(function (k) { return store.allowed(varsayilan, k, {}) === false; }),
   'kişisel veri taşıyan türlerin HEPSİ varsayılan olarak KAPALI');

/* ---------------- 4. Webhook güvenlik kapıları ---------------- */
head('Webhook — üç güvenlik kapısı');

const webhook = require('../api/telegram/webhook.js');
function sahteRes() {
  const r = { kod: 0, govde: null, basliklar: {} };
  r.setHeader = function (k, v) { r.basliklar[k] = v; };
  r.status = function (c) { r.kod = c; return r; };
  r.json = function (b) { r.govde = b; return r; };
  return r;
}
function istek(secret, chatId, text) {
  return {
    method: 'POST',
    headers: secret === undefined ? {} : { 'x-telegram-bot-api-secret-token': secret },
    body: { message: { chat: { id: chatId }, text: text } }
  };
}

const gercekFetch = global.fetch;
let gonderilen = [];
global.fetch = function (url, opt) {
  gonderilen.push({ url: String(url), body: JSON.parse(opt.body) });
  return Promise.resolve({ ok: true, text: function () { return Promise.resolve(''); } });
};

(async function () {
  const eskiSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const eskiToken = process.env.TELEGRAM_BOT_TOKEN;
  const eskiChat = process.env.TELEGRAM_CHAT_ID;

  // 1. kapi: secret tanimli degil -> uc TAMAMEN kapali
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  process.env.TELEGRAM_BOT_TOKEN = 'sahte-jeton';
  process.env.TELEGRAM_CHAT_ID = '12345';
  let r = sahteRes();
  await webhook(istek('herhangi', '12345', '/stats'), r);
  ok(r.govde && r.govde.skipped === 'webhook_secret_not_set',
     'gizli jeton tanımlı değilken uç KAPALI — doğrulanamayan istek kabul edilmiyor');
  ok(gonderilen.length === 0, 'hiçbir mesaj gönderilmedi');

  // 1. kapi: yanlis secret
  process.env.TELEGRAM_WEBHOOK_SECRET = 'dogru-gizli-deger';
  gonderilen = [];
  r = sahteRes();
  await webhook(istek('yanlis-deger-ayni-uzunluk', '12345', '/stats'), r);
  ok(r.govde && r.govde.skipped === 'bad_secret', 'yanlış gizli jeton reddediliyor');
  ok(gonderilen.length === 0, 'yanlış jetonla mesaj gönderilmiyor');

  // 1. kapi: secret hic yok
  gonderilen = [];
  r = sahteRes();
  await webhook(istek(undefined, '12345', '/stats'), r);
  ok(r.govde && r.govde.skipped === 'bad_secret', 'jeton başlığı hiç yokken reddediliyor');

  // 2. kapi: yanlis sohbet
  gonderilen = [];
  r = sahteRes();
  await webhook(istek('dogru-gizli-deger', '99999', '/stats'), r);
  ok(r.govde && r.govde.skipped === 'chat_not_allowed',
     'başka sohbetten gelen komut reddediliyor — botu bulan herkes kullanamaz');
  ok(gonderilen.length === 0, 'yabancı sohbete yanıt gönderilmiyor');

  // 3. kapi: taninmayan komut
  gonderilen = [];
  r = sahteRes();
  await webhook(istek('dogru-gizli-deger', '12345', '/silmece hepsini'), r);
  ok(r.govde && r.govde.skipped === 'unknown_command', 'beyaz listede olmayan komut yok sayılıyor');

  // Yanlis yontem
  r = sahteRes();
  await webhook({ method: 'GET', headers: {}, body: null }, r);
  ok(r.kod === 405, 'GET reddediliyor (405)');

  // Reddedilen isteklerin hepsi 200 donuyor mu?
  r = sahteRes();
  await webhook(istek('yanlis', '12345', '/stats'), r);
  ok(r.kod === 200, 'reddedilen istek de 200 dönüyor — Telegram webhook’u devre dışı bırakmasın');

  global.fetch = gercekFetch;
  if (eskiSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET; else process.env.TELEGRAM_WEBHOOK_SECRET = eskiSecret;
  if (eskiToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = eskiToken;
  if (eskiChat === undefined) delete process.env.TELEGRAM_CHAT_ID; else process.env.TELEGRAM_CHAT_ID = eskiChat;

  head('Gönderim — yapılandırılmamışken sessizce devre dışı');
  const s = await tg.sendMessage('deneme');
  ok(s.ok === false && s.error === 'not_configured',
     'jeton yokken hata FIRLATMIYOR, sonuç nesnesi dönüyor');

  process.stdout.write('\n\x1b[1m' + (failed ? 'SONUÇ: BAŞARISIZ' : 'SONUÇ: HEPSİ GEÇTİ') + '\x1b[0m\n');
  process.exit(failed);
})();
