'use strict';

/**
 * Yönetici: iyzico ürün + fiyat planı oluşturma (ödemeyi açan SON adım).
 *
 *   GET  /api/admin/iyzico-plan                  → durum (sır dönmez)
 *   POST /api/admin/iyzico-plan { confirm }      → ürün + 2 fiyat planı oluşturur
 *
 * NEDEN VAR
 *
 * Ödeme ucu plan referans kodu olmadan açılmıyor: `/api/checkout` sırası
 * YAPILANDIRMA → PLAN REFERANSI → OTURUM; referans yoksa 503
 * `checkout_unconfigured` dönüyor ve /odeme "başlatılamıyor" diyor.
 * 16.10.2026 canlı ölçümünde tam bu hâl görüldü: `enabled: true`,
 * `plans: []` (koşu 38983000527).
 *
 * Referans kodu iyzico panelinden elle de alınabilir. Bu uç aynı işi
 * SUNUCUDAKİ anahtarlarla yapar: anahtarların hiçbir yere (sohbete, günlüğe,
 * yanıta) çıkmasına gerek kalmadan kodlar üretilir ve yöneticiye gösterilir.
 * Dönen kodlar sır değildir — ödeme formunu başlatan plan kimlikleridir ve
 * Vercel'e `IYZICO_PRICING_PLAN_PRO` / `IYZICO_PRICING_PLAN_ENTERPRISE`
 * olarak girilir.
 *
 * GÜVENLİK
 *
 * - Yalnızca ADMIN_EMAILS içindeki oturum. Değişken yoksa uç KAPALI.
 * - POST açık onay ister. CANLI ortamda ayrı ve daha güçlü onay ister:
 *   canlı bir ürün/plan oluşturmak para tarafını ilgilendiren bir karardır.
 * - Fiyat `api/_lib/plans.js`'ten OKUNUR; istekten fiyat alınmaz. Aksi hâlde
 *   bu uç, sözleşmedeki fiyattan farklı bir plan üretebilirdi.
 * - Anahtarlar okunmaz, basılmaz, yanıta konmaz.
 * - Para ÇEKMEZ: yalnızca ürün ve fiyat planı tanımlar.
 */

const auth = require('../_lib/auth.js');
const iyzico = require('../_lib/iyzico.js');
const tg = require('../_lib/telegram.js');
const { PLANS } = require('../_lib/plans.js');

/* Oluşturulacak planlar ve hangi ortam değişkenine yazılacakları. */
const PLANLAR = [
  { id: 'pro', ad: 'Cyber Lion AI Pro (aylık)', env: 'IYZICO_PRICING_PLAN_PRO' },
  { id: 'enterprise', ad: 'Cyber Lion AI Enterprise (aylık)', env: 'IYZICO_PRICING_PLAN_ENTERPRISE' }
];

const ONAY_SANDBOX = 'PLAN OLUSTUR';
const ONAY_CANLI = 'PLAN OLUSTUR CANLI';

function admins() {
  return String(process.env.ADMIN_EMAILS || '').split(',')
    .map(function (e) { return e.trim().toLowerCase(); }).filter(Boolean);
}

function referansOf(data) {
  const d = (data && data.data) || data || {};
  const r = d.referenceCode || d.pricingPlanReferenceCode || d.productReferenceCode;
  return typeof r === 'string' && r.trim() ? r.trim() : null;
}

/** Hangi plan referansı env'de TANIMLI: değer dönmez, yalnızca var/yok. */
function tanimliPlanlar() {
  return PLANLAR.filter(function (p) {
    const v = process.env[p.env];
    return typeof v === 'string' && v.trim().length > 0;
  }).map(function (p) { return p.id; });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  const list = admins();
  if (!list.length || !auth.isConfigured()) {
    return res.status(503).json({ error: { code: 'admin_unconfigured' } });
  }
  const user = await auth.resolveUser(req, res);
  if (!user) return res.status(401).json({ error: { code: 'auth_required' } });
  if (list.indexOf(String(user.email || '').toLowerCase()) === -1) {
    return res.status(403).json({ error: { code: 'forbidden' } });
  }

  const ortam = iyzico.environmentName();   /* 'sandbox' | 'production' | null */

  if (req.method === 'GET') {
    /* Durum: ne eksik, hangi onay gerekiyor. Anahtar ya da referans DEĞERİ
       dönmüyor; yalnızca hangi planın tanımlı olduğu. */
    return res.status(200).json({
      configured: iyzico.isConfigured(),
      enabled: iyzico.isEnabled(),
      environment: ortam,
      definedPlans: tanimliPlanlar(),
      missingPlans: PLANLAR.filter(function (p) { return tanimliPlanlar().indexOf(p.id) === -1; })
        .map(function (p) { return p.env; }),
      confirmWord: ortam === 'production' ? ONAY_CANLI : ONAY_SANDBOX,
      prices: PLANLAR.map(function (p) {
        return { plan: p.id, priceTry: PLANS[p.id].priceTry, vatIncluded: true };
      })
    });
  }

  if (!iyzico.isConfigured()) {
    return res.status(503).json({ error: { code: 'iyzico_unconfigured' } });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const onay = String((body && body.confirm) || '').trim().toUpperCase();
  const gereken = ortam === 'production' ? ONAY_CANLI : ONAY_SANDBOX;
  if (onay !== gereken) {
    /* Canlıda sandbox onayı yetmez: ortam adı taban adresten türüyor ve
       yönetici hangi ortamda olduğunu bilerek onaylamalı. */
    return res.status(400).json({ error: { code: 'confirmation_required' }, confirmWord: gereken, environment: ortam });
  }

  const urunAdi = (body && typeof body.productName === 'string' && body.productName.trim())
    ? body.productName.trim().slice(0, 80)
    : 'Cyber Lion AI';

  const urun = await iyzico.createProduct(urunAdi, 'Web sitesi güvenlik taraması ve izleme aboneliği');
  if (!urun.ok) {
    if (console && console.error) console.error('iyzico plan setup: product failed', urun.reason, urun.errorCode || '');
    return res.status(502).json({ error: { code: 'product_failed', reason: urun.reason || null } });
  }
  const urunRef = referansOf(urun.data);
  if (!urunRef) {
    if (console && console.error) console.error('iyzico plan setup: product ref missing');
    return res.status(502).json({ error: { code: 'product_ref_missing' } });
  }

  const sonuc = [];
  const hatalar = [];
  for (const p of PLANLAR) {
    /* Fiyat plans.js'ten: sözleşmedeki tutarla ayrışmasın. */
    const r = await iyzico.createPricingPlan(urunRef, { name: p.ad, priceTry: PLANS[p.id].priceTry });
    if (!r.ok) {
      if (console && console.error) console.error('iyzico plan setup: plan failed', p.id, r.reason, r.errorCode || '');
      hatalar.push({ plan: p.id, reason: r.reason || null });
      continue;
    }
    const ref = referansOf(r.data);
    if (!ref) { hatalar.push({ plan: p.id, reason: 'ref_missing' }); continue; }
    sonuc.push({ plan: p.id, env: p.env, referenceCode: ref, priceTry: PLANS[p.id].priceTry });
  }

  if (!sonuc.length) {
    return res.status(502).json({ error: { code: 'plans_failed' }, failures: hatalar });
  }

  await tg.sendTelegram(tg.mesaj.iyzicoPlanOlusturuldu(ortam, urunAdi,
    sonuc.map(function (s) { return s.plan; })), { type: 'payment', priority: true });

  /* Kodlar yöneticiye gösteriliyor: Vercel'e ELLE girilecekler. Uç onları
     hiçbir yere yazmıyor — ortam değişkenini ancak insan ayarlayabilir. */
  return res.status(200).json({
    ok: true,
    environment: ortam,
    productReferenceCode: urunRef,
    plans: sonuc,
    failures: hatalar,
    nextStep: 'Bu referans kodlarını Vercel ortam değişkenlerine girin ve yeniden dağıtın: '
      + sonuc.map(function (s) { return s.env; }).join(', ')
  });
};
