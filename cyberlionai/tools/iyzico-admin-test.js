'use strict';

/**
 * Yönetici iyzico plan ucunun ağsız sınaması.
 *
 * Bu uç ödemeyi AÇAN son adımı atıyor (fiyat planı referans kodu). Yanlış
 * kapı = canlı iyzico hesabında yabancı birinin ürün/plan açması; yanlış
 * fiyat = sözleşmedekinden farklı tutarla abonelik. İkisi de kodla kilitli.
 *
 * Ağ YOK: dosya metni + yüklenen modül okunuyor.
 */

const fs = require('fs');
const path = require('path');

const KOK = path.join(__dirname, '..');
const UC = path.join(KOK, 'api', 'admin', 'iyzico-plan.js');
const BELGE = path.join(KOK, 'docs', 'iyzico.md');

let kaldi = 0;
function ok(ad) { console.log('  ✓ ' + ad); }
function hata(ad, aciklama) { kaldi++; console.log('  ✗ ' + ad + (aciklama ? ' — ' + aciklama : '')); }
function bekle(kosul, ad, aciklama) { kosul ? ok(ad) : hata(ad, aciklama); }

const src = fs.readFileSync(UC, 'utf8');
const doc = fs.readFileSync(BELGE, 'utf8');
const mod = require(UC);
const plans = require(path.join(KOK, 'api', '_lib', 'plans.js'));

console.log('Yönetici iyzico plan ucu');

/* ---- 1. Kapılar ---- */
bekle(typeof mod === 'function', 'uç bir isteyici (handler) döndürüyor');
bekle(/ADMIN_EMAILS/.test(src), 'ADMIN_EMAILS okunuyor');
bekle(/admin_unconfigured/.test(src) && /!list\.length/.test(src),
  'ADMIN_EMAILS boşsa uç kapalı (503 admin_unconfigured)');
bekle(/auth\.resolveUser/.test(src) && /auth_required/.test(src),
  'oturum yoksa 401 auth_required');
bekle(/forbidden/.test(src) && /indexOf\(String\(user\.email/.test(src),
  'listede olmayan e-posta 403 forbidden');
bekle(/method_not_allowed/.test(src) && /'Allow'/.test(src),
  'GET/POST dışı yöntem 405 + Allow başlığı');
bekle(/no-store/.test(src), 'Cache-Control: no-store');

/* bearerKabul YOK: bu uç yalnızca tarayıcı oturumuyla çalışsın. Mobil
   uygulamanın canlı iyzico hesabında ürün açması için bir sebep yok. */
bekle(!/bearerKabul/.test(src), 'Bearer belirteci kabul edilmiyor (yalnızca oturum çerezi)');

/* ---- 2. Onay sözcüğü ---- */
bekle(/confirmation_required/.test(src), 'onay yoksa 400 confirmation_required');
bekle(/PLAN OLUSTUR CANLI/.test(src), 'canlı ortam için ayrı onay sözcüğü var');
bekle(/ortam === 'production' \? ONAY_CANLI : ONAY_SANDBOX/.test(src),
  'onay sözcüğü ortama göre seçiliyor');
bekle(/ONAY_SANDBOX = 'PLAN OLUSTUR'/.test(src), 'kum havuzu onayı PLAN OLUSTUR');
/* Canlı onay sözcüğü sandbox'ınkini İÇERDİĞİ için karşılaştırma eşitlik
   olmalı; startsWith olsaydı sandbox onayı canlıda da geçerdi. */
bekle(/onay !== gereken/.test(src) && !/startsWith\(gereken/.test(src),
  'onay karşılaştırması tam eşitlik (sandbox onayı canlıda geçmez)');

/* ---- 3. Fiyat ---- */
bekle(/PLANS\[p\.id\]\.priceTry/.test(src), 'fiyat plans.js priceTry değerinden okunuyor');
bekle(!/\b299\b/.test(src) && !/\b2499\b/.test(src),
  'uçta elle yazılmış fiyat yok', 'fiyat yalnızca plans.js\'te olmalı');
bekle(!/body[^\n]*price/i.test(src) && !/body\.priceTry/.test(src),
  'istek gövdesinden fiyat alınmıyor');
bekle(plans.PLANS.pro.priceTry > 0 && plans.PLANS.enterprise.priceTry > 0,
  'plans.js iki ücretli plan için fiyat taşıyor');

/* ---- 4. Sır sızıntısı ---- */
const sirAdlar = ['IYZICO_API_KEY', 'IYZICO_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
bekle(sirAdlar.every(function (a) { return src.indexOf(a) === -1; }),
  'uç anahtar adlarını hiç okumuyor (iyzico.js üzerinden gidiyor)');
bekle(!/console\.log/.test(src), 'console.log yok (yalnızca console.error, sebep kodlarıyla)');
bekle(/console\.error/.test(src), 'başarısızlıklar sunucu günlüğüne yazılıyor');

/* GET yanıtında plan referansı DEĞERİ dönmemeli: yalnızca var/yok. */
bekle(/definedPlans/.test(src) && !/referenceCode: process\.env/.test(src),
  'GET durumu referans kodu değerini dönmüyor');

/* ---- 5. Yan etki sınırı ---- */
bekle(/createProduct/.test(src) && /createPricingPlan/.test(src),
  'yalnızca ürün + fiyat planı oluşturuyor');
bekle(!/initializeCheckoutForm/.test(src) && !/createCustomer/.test(src),
  'ödeme başlatmıyor, müşteri oluşturmuyor (para çekmez)');
bekle(!/\bdb\b/.test(src.replace(/[A-Za-z_]db|db[A-Za-z_]/g, '')),
  'veritabanına yazmıyor');
bekle(/iyzico_unconfigured/.test(src),
  'iyzico anahtarları yoksa 503 iyzico_unconfigured');

/* ---- 6. Bildirim ---- */
bekle(/iyzicoPlanOlusturuldu/.test(src), 'Telegram denetim bildirimi gönderiliyor');
const tg = fs.readFileSync(path.join(KOK, 'api', '_lib', 'telegram.js'), 'utf8');
bekle(/iyzicoPlanOlusturuldu: function/.test(tg), 'bildirim metni telegram.js\'te tanımlı');
const mesaj = require(path.join(KOK, 'api', '_lib', 'telegram.js'))
  .mesaj.iyzicoPlanOlusturuldu('production', 'Cyber Lion AI', ['pro']);
bekle(typeof mesaj === 'string' && mesaj.indexOf('production') !== -1,
  'bildirim ortamı adlandırıyor');

/* ---- 7. Belge ---- */
bekle(/api\/webhooks\/iyzico/.test(doc), 'belge bildirim URL\'ini doğru veriyor');
bekle(/api\/checkout-return/.test(doc), 'belge geri dönüş URL\'ini ayrıca veriyor');
/* Panelde yanlış adres yazılmasın: belge o adresin OLMADIĞINI söylemeli. */
bekle(/\/api\/odeme\/callback/.test(doc) && /uç \*\*yok\*\*|uç yok/.test(doc),
  'belge /api/odeme/callback diye bir uç olmadığını söylüyor');
bekle(fs.existsSync(path.join(KOK, 'api', 'webhooks', 'iyzico.js')),
  'belgedeki webhook ucu dosya olarak var');
bekle(fs.existsSync(path.join(KOK, 'api', 'checkout-return.js')),
  'belgedeki geri dönüş ucu dosya olarak var');
bekle(/IYZICO_PRICING_PLAN_PRO/.test(doc), 'belge eksik değişkeni adlandırıyor');
bekle(/IYZICO_ABONELIK_ETKINLESTIRICI/.test(doc) && /okunm/i.test(doc),
  'belge okunmayan adları uyarı olarak işaretliyor');
bekle(/\/api\/admin\/iyzico-plan/.test(doc), 'belge yönetici ucunu anlatıyor');
bekle(/PLAN OLUSTUR CANLI/.test(doc), 'belge canlı onay sözcüğünü veriyor');

/* Okunmayan adlar gerçekten okunmuyor mu: belge yanlış bilgi vermesin. */
/* Bu iki adı YALNIZCA onların okunmadığını iddia eden sınamalar anıyor;
   onları dışlamasak sınama kendi metnine takılırdı. */
const DISLANAN = /(iyzico-admin-test|iyzico-checklist-test)\.js$/;
const kod = ['api', 'tools'].map(function (d) {
  return fs.readdirSync(path.join(KOK, d), { recursive: true })
    .filter(function (f) { return /\.js$/.test(f) && !DISLANAN.test(f); })
    .map(function (f) { return fs.readFileSync(path.join(KOK, d, f), 'utf8'); }).join('\n');
}).join('\n');
bekle(kod.indexOf('IYZICO_ABONELIK_ETKINLESTIRICI') === -1
  && kod.indexOf('IYZICO_FIYATLANDIRMA_PLANI') === -1,
  'o adlar gerçekten hiçbir kodda okunmuyor');

console.log('');
if (kaldi) { console.log('KALDI: ' + kaldi); process.exit(1); }
console.log('TAMAM');
