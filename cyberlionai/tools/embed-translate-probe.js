'use strict';

/**
 * Canlı ölçüm: "çevir ve vektörleştir" Türkçe anlamsal aramayı düzeltiyor mu?
 *
 * api/_lib/embed.js'i GERÇEK uçlarla çağırır (DeepSeek çeviri + Supabase
 * Edge Function `embed`) ve her soruda doğru hafıza kaydının en üstte olup
 * olmadığını çeviri açık/kapalı karşılaştırır. Metin ve anahtar yazdırılmaz;
 * yalnızca skorlar.
 *
 *   read -rsp 'DeepSeek: ' DEEPSEEK_API_KEY; echo; export DEEPSEEK_API_KEY
 *   node tools/embed-translate-probe.js; unset DEEPSEEK_API_KEY
 *
 * Ortam: DEEPSEEK_API_KEY (zorunlu). EMBED_SHARED_SECRET yoksa
 * ~/.config/cyberlionai/embed-secret.env okunur. SUPABASE_URL varsayılanı
 * cyberlionai projesi. Fonksiyon --no-verify-jwt ile yüklü (kimlik
 * doğrulaması paylaşılan sırla), bu yüzden servis rolü anahtarı gerekmez.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (!process.env.DEEPSEEK_API_KEY) { console.error('DEEPSEEK_API_KEY gerekli'); process.exit(2); }
if (!process.env.EMBED_SHARED_SECRET) {
  const f = path.join(os.homedir(), '.config/cyberlionai/embed-secret.env');
  process.env.EMBED_SHARED_SECRET = fs.readFileSync(f, 'utf8').trim().split('=').slice(1).join('=');
}
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://aohsgagiyaseinhmyfub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'jwt-dogrulamasi-kapali';

const embed = require('../api/_lib/embed');

/* Her senaryoda ilk kayıt doğru cevap; diğerleri aynı hafızadaki çeldiriciler. */
const HAFIZA = [
  'SSL sertifikamın süresi doldu, Certbot ile nasıl yenilerim?',
  'Sitemde oltalama (phishing) sayfası olduğu uyarısı aldım',
  'Güvenlik duvarında 22 numaralı portu sadece ofis IP\'sine açtım',
  'Planınızın aylık fiyatı ne kadar, fatura kesiyor musunuz?',
  'WordPress eklentilerimi güncellemem gerekiyor mu?',
  'Yarın ofiste toplantı var, kahve alalım'
];
const SORULAR = [
  ['Sertifikam bitmiş, yenilemek için ne yapmalıyım?', 0],
  ['Bana şüpheli bir link geldi, sahte site olabilir mi?', 1],
  ['Firewall kurallarını nasıl ayarlamıştık?', 2],
  ['Ucretlendirme nasil, fiyatlar neler?', 3],
  ['Eklentileri güncel tutmak önemli mi?', 4],
  ['Do I need to renew my certificate?', 0]
];

const cos = function (a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

async function olc(etiket) {
  const t0 = Date.now();
  const hafiza = await embed.embed(HAFIZA);
  let dogru = 0;
  let fark = 0;
  const satirlar = [];
  for (const [soru, beklenen] of SORULAR) {
    const q = (await embed.embed([soru]))[0];
    const sk = hafiza.map(function (v) { return cos(q, v); });
    const enIyi = sk.indexOf(Math.max.apply(null, sk));
    const rakip = Math.max.apply(null, sk.filter(function (_, i) { return i !== beklenen; }));
    const ok = enIyi === beklenen;
    dogru += ok ? 1 : 0;
    fark += sk[beklenen] - rakip;
    satirlar.push('  ' + (ok ? '✅' : '❌') + ' fark=' + (sk[beklenen] - rakip >= 0 ? '+' : '') + (sk[beklenen] - rakip).toFixed(3) + '  ' + soru);
  }
  console.log('=== ' + etiket + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' sn) ===');
  console.log(satirlar.join('\n'));
  console.log('  doğru: ' + dogru + '/' + SORULAR.length + '   ort. fark: ' + (fark / SORULAR.length).toFixed(3) + '\n');
  return dogru;
}

(async function () {
  process.env.EMBED_TRANSLATE = 'off';
  await olc('Çeviri KAPALI (eski davranış)');
  delete process.env.EMBED_TRANSLATE;
  const d = await olc('Çeviri AÇIK (DeepSeek flash → gte-small)');
  console.log('"embed_translate_fail" satırı görüldüyse çeviri o metinde düştü ve özgün metin kullanıldı.');
  process.exit(d >= SORULAR.length - 1 ? 0 : 1);
})().catch(function (e) { console.error('HATA', e.message); process.exit(1); });
