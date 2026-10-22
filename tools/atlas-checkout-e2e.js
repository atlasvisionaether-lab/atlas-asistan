'use strict';
/**
 * /checkout sipariş formunun tarayıcı sınaması (Playwright, Chromium).
 *
 *   NODE_PATH=$(npm root -g) node tools/atlas-checkout-e2e.js [ekran-görüntüsü-klasörü]
 *
 * Ağ: intl-tel-input ve libphonenumber-js jsDelivr'den yüklenir (sayfadaki
 * sürüm ve SRI ile). /api/atlas-checkout bu betikteki sahte sunucudan gelir;
 * iyzico'ya gidilmez. CI'da koşmuyor (tarayıcı + CDN gerekiyor).
 *
 * Sınananlar: TR/DE/US seçimi ve E.164; ülkeye göre örnek numara; boş fatura
 * alanlarıyla gönderim; hatalı TC / VKN'de kırmızı kenarlık + mesaj ve
 * gönderimin durması; EN hata metni; AB dışı ülkede aktarım onayı.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = process.argv[2] || null;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp' };

let posts = [];
let modeEnabled = true;

/* vercel.json'daki yeniden yazımın yerel karşılığı. */
const REWRITES = { '/checkout': '/checkout.html', '/cl-billing-form.js': '/cyberlionai/billing-form.js' };

const server = http.createServer(function (req, res) {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/atlas-checkout') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ enabled: modeEnabled, testMode: true }));
    }
    let body = '';
    req.on('data', function (c) { body += c; });
    req.on('end', function () {
      posts.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: '/sahte-iyzico' }));
    });
    return;
  }
  if (u.pathname === '/sahte-iyzico') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end('<title>iyzico</title><h1>iyzico</h1>');
  }
  const p = path.join(ROOT, REWRITES[u.pathname] || u.pathname);
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

let hata = 0;
function sina(ad, bulunan, beklenen) {
  const ok = JSON.stringify(bulunan) === JSON.stringify(beklenen);
  if (!ok) hata++;
  console.log((ok ? '  ok  ' : '  HATA') + '  ' + ad
    + (ok ? '' : '\n        beklenen: ' + JSON.stringify(beklenen) + '\n        bulunan : ' + JSON.stringify(bulunan)));
}

async function ac(browser, base, query, width) {
  const page = await browser.newPage({ viewport: { width: width || 1280, height: 900 } });
  const hatalar = [];
  page.on('pageerror', function (e) { hatalar.push(e.message); });
  await page.goto(base + '/checkout?' + (query || 'plan=pro'));
  await page.waitForFunction(function () { return window.intlTelInput && document.querySelector('.iti__selected-dial-code'); });
  page.hatalar = hatalar;
  return page;
}

/** Ülke seçiciyi gerçek kullanıcı gibi açıp aramadan seçer. */
async function ulkeSec(page, ara, iso2) {
  await page.click('.iti__selected-country');
  await page.fill('.iti__search-input', ara);
  await page.click('.iti__country[data-iso2="' + iso2 + '"]');
}

async function doldur(page, ek) {
  const v = Object.assign({ name: 'Ayşe Yılmaz', clinic: 'Işıl Klinik', phone: '5321234567', email: 'ayse@ornek.com', address: 'Cevizli Mah. Zuhal Cad. No 46', city: 'İstanbul' }, ek || {});
  await page.fill('#co-name', v.name);
  await page.fill('#co-clinic', v.clinic);
  await page.click('#co-phone');
  await page.keyboard.type(v.phone);
  await page.fill('#co-email', v.email);
  await page.fill('#co-address', v.address);
  await page.fill('#co-city', v.city);
  await page.check('#co-consent');
  /* TR de AB/AEA dışı: aktarım onayı görünür ve zorunlu (US sınaması onaysız
     gönderimi ayrıca deniyor). */
  if (v.transfer !== false && await page.isVisible('#co-transfer')) await page.check('#co-transfer');
}

async function alanDurumu(page, field) {
  return page.evaluate(function (f) {
    const box = document.querySelector('[data-field="' + f + '"]');
    const err = box.querySelector('.err');
    const input = box.querySelector('input');
    return {
      invalid: box.classList.contains('invalid'),
      valid: box.classList.contains('valid'),
      mesaj: err && !err.hidden ? err.textContent : '',
      kenar: getComputedStyle(input).borderTopColor
    };
  }, field);
}

(async function () {
  await new Promise(function (ok) { server.listen(0, '127.0.0.1', ok); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();

  console.log('Ülke + telefon');
  let page = await ac(browser, base);
  sina('varsayılan TR +90', await page.textContent('.iti__selected-dial-code'), '+90');
  const trPh = await page.getAttribute('#co-phone', 'placeholder');
  sina('TR örnek numara placeholder (5xx…)', /^0?5\d\d/.test(trPh.replace(/\s/g, '')), true);
  await page.click('#co-phone');
  await page.keyboard.type('53a2-12345 67');
  sina('yalnızca rakam (harf kabul edilmez)', /[a-z]/i.test(await page.inputValue('#co-phone')), false);
  await page.fill('#co-phone', '');

  await ulkeSec(page, 'Alman', 'de');
  sina('DE seçilince kod +49', await page.textContent('.iti__selected-dial-code'), '+49');
  const dePh = await page.getAttribute('#co-phone', 'placeholder');
  sina('placeholder ülkeyle değişti', dePh !== trPh && dePh.length > 5, true);
  await page.click('#co-phone');
  await page.keyboard.type('015123456789');
  await page.click('#co-email');
  sina('DE numara geçerli ✓', (await alanDurumu(page, 'phone')).valid, true);
  sina('DE: VAT ID alanı görünür, TC gizli', await page.evaluate(function () {
    return [document.querySelector('[data-field="vatId"]').hidden, document.querySelector('[data-field="tcNo"]').hidden];
  }), [false, true]);
  sina('DE (AB): aktarım onayı gizli', await page.isHidden('#co-transfer-wrap'), true);

  await page.fill('#co-phone', '');
  await ulkeSec(page, 'Amerika', 'us');
  sina('US seçilince kod +1', await page.textContent('.iti__selected-dial-code'), '+1');
  sina('US (AB dışı): aktarım onayı görünür', await page.isVisible('#co-transfer-wrap'), true);
  await doldur(page, { phone: '2015550123', city: 'Newark', address: '100 Main Street, Suite 4', transfer: false });
  await page.click('#co-submit');
  sina('US: onay verilmeden gönderilmez', [posts.length, (await alanDurumu(page, 'consentTransfer')).mesaj.length > 0], [0, true]);
  await page.check('#co-transfer');
  await Promise.all([page.waitForURL('**/sahte-iyzico'), page.click('#co-submit')]);
  sina('US gönderildi: E.164 +12015550123, ülke US', [posts[0].phone, posts[0].country, posts[0].consentTransfer], ['+12015550123', 'US', true]);
  sina('sayfa hatası yok', page.hatalar, []);
  await page.close();

  console.log('\nTR, boş fatura alanları');
  posts = [];
  page = await ac(browser, base, 'plan=standart');
  await doldur(page);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'tr-dolu.png'), fullPage: false, clip: await page.locator('#coForm').boundingBox() });
  await Promise.all([page.waitForURL('**/sahte-iyzico'), page.click('#co-submit')]);
  sina('fatura boşken gönderildi', posts.length, 1);
  sina('TR E.164 +905321234567', [posts[0].phone, posts[0].country, posts[0].plan], ['+905321234567', 'TR', 'standart']);
  sina('fatura alanları boş gitti', posts[0].billing, { type: 'individual', tcNo: '', taxNo: '', taxOffice: '', vatId: '', companyRegNo: '' });
  await page.close();

  console.log('\nHatalı fatura alanları');
  posts = [];
  page = await ac(browser, base);
  await doldur(page);
  await page.click('#co-billing summary');
  await page.fill('#co-tc', '12345678901');
  await page.click('#co-submit');
  let tc = await alanDurumu(page, 'tcNo');
  sina('hatalı TC: gönderim yok, kırmızı + mesaj', [posts.length, tc.invalid, tc.kenar, tc.mesaj.indexOf('TC Kimlik No geçersiz') === 0], [0, true, 'rgb(248, 113, 113)', true]);
  sina('odak TC kutusunda', await page.evaluate(function () { return document.activeElement.id; }), 'co-tc');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'tc-hata.png'), clip: await page.locator('#coForm').boundingBox() });
  await page.fill('#co-tc', '10000000146');
  tc = await alanDurumu(page, 'tcNo');
  sina('geçerli TC: hata kalktı, yeşil ✓', [tc.invalid, tc.valid, await page.isVisible('[data-field="tcNo"] .ok')], [false, true, true]);
  await page.check('input[name="billingType"][value="corporate"]', { force: true });
  sina('kurumsal: VKN + vergi dairesi görünür, TC gizli', await page.evaluate(function () {
    return ['taxNo', 'taxOffice', 'tcNo'].map(function (f) { return document.querySelector('[data-field="' + f + '"]').hidden; });
  }), [false, false, true]);
  await page.fill('#co-vkn', '123456789');
  await page.click('#co-submit');
  const vkn = await alanDurumu(page, 'taxNo');
  sina('VKN 9 hane: gönderim yok + hata', [posts.length, vkn.invalid, vkn.mesaj.length > 0], [0, true, true]);
  await page.fill('#co-vkn', '1234567890');
  await page.fill('#co-taxoffice', 'Kadıköy');
  await Promise.all([page.waitForURL('**/sahte-iyzico'), page.click('#co-submit')]);
  sina('geçerli VKN ile gönderildi', [posts[0].billing.type, posts[0].billing.taxNo, posts[0].billing.taxOffice], ['corporate', '1234567890', 'Kadıköy']);
  await page.close();

  console.log('\nEN + boş zorunlu alanlar');
  page = await ac(browser, base, 'plan=pro&lang=en');
  await page.click('#co-submit');
  sina('EN etiket', await page.textContent('label[for="co-name"]'), 'Full name');
  sina('EN hata metni', (await alanDurumu(page, 'name')).mesaj, 'This field is required.');
  sina('zorunlu alan kenarı kırmızı', (await alanDurumu(page, 'email')).kenar, 'rgb(248, 113, 113)');
  await page.close();

  console.log('\nÖdeme kapalı (WhatsApp)');
  modeEnabled = false;
  page = await ac(browser, base);
  await page.waitForTimeout(300);
  sina('buton metni WhatsApp', (await page.textContent('#co-submit')).trim(), 'WhatsApp ile Siparişi Tamamla');
  await doldur(page);
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('#co-submit')]);
  const wa = decodeURIComponent(new URL(popup.url().replace('api.whatsapp.com/send', 'x.co/send')).searchParams.get('text') || popup.url());
  sina('WhatsApp mesajında E.164 telefon', wa.indexOf('+905321234567') !== -1, true);
  await page.close();
  modeEnabled = true;

  console.log('\nMobil (400px)');
  page = await ac(browser, base, 'plan=vip', 400);
  await page.click('#co-billing summary');
  const tasma = await page.evaluate(function () { return document.documentElement.scrollWidth > window.innerWidth; });
  sina('yatay taşma yok', tasma, false);
  if (SHOTS) {
    await page.locator('#coForm').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, 'mobil.png'), fullPage: true });
  }
  await page.close();

  await browser.close();
  server.close();
  console.log(hata === 0 ? '\nTümü geçti.' : '\n' + hata + ' sınama BAŞARISIZ.');
  process.exit(hata === 0 ? 0 : 1);
})().catch(function (e) { console.error(e); process.exit(1); });
