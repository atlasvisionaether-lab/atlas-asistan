'use strict';

/**
 * Aşama 2b + 3 sınaması: embedding, anlamsal hafıza, e-posta sertifikası,
 * satış kapanışı (teklif), yeni bulgu uyarısı, sabah özeti.
 *
 *   api/_lib/embed.js · api/_lib/memory.js (searchMessages) · api/_lib/mailer.js
 *   api/_lib/offer.js · api/_lib/monitor.js (newFindings) · api/cron/morning-digest.js
 *   api/assistant-ai.js · api/user/delete.js
 *
 * Sabitlenen kararlar:
 *   - Embedding varsayılanı Supabase Edge Function; sır başlıkta, metin dışarı
 *     başka sağlayıcıya gitmez. Bozuk/yanlış boyutlu vektör reddedilir.
 *   - Anlamsal eşleşmeler tarih etiketiyle ve son mesajlardan ÖNCE gider;
 *     embedding düşerse asistan son mesajlarla devam eder.
 *   - Mail sağlayıcısı yoksa hiç istek atılmaz; silme başarılı, mail:'unconfigured'.
 *   - Teklif metni plans.js'ten: ₺299, "29$" / "otomatik kapat" / "7/24" YOK.
 *     Ücretli ya da planı okunamayan kullanıcıya teklif yok; 24 saatte bir.
 *   - Sabah özeti yalnızca ölçülen olayları yazar; kullanıcı başına günde bir.
 *
 * Ağ yok.
 */

const path = require('node:path');
const Module = require('node:module');
const API = path.join(__dirname, '..', 'api');

let gecti = 0;
const hatalar = [];
function dogru(ad, k) { if (k) { gecti += 1; return; } hatalar.push(ad); }
function esit(ad, b, e) {
  if (JSON.stringify(b) === JSON.stringify(e)) { gecti += 1; return; }
  hatalar.push(ad + ' (beklenen ' + JSON.stringify(e) + ', bulunan ' + JSON.stringify(b) + ')');
}
function sapla(rel, exp) {
  const tam = require.resolve(path.join(API, rel));
  const m = new Module(tam, null); m.filename = tam; m.loaded = true; m.exports = exp; require.cache[tam] = m;
}

/* ---------- Ortam ---------- */
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
process.env.SUPABASE_URL = 'https://sahte.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'servis-rolu-sahte';
process.env.EMBED_SHARED_SECRET = 'embed-sirri-0123456789';
process.env.AI_ASSISTANT_ENABLED = 'true';
process.env.DEEPSEEK_API_KEY = 'sk-deepseek-test-key-0123456789abcdef';

/* ---------- Bellek içi veri ---------- */
const db = { prefs: {}, messages: [], certs: [], subs: {}, alerts: [] };
let sira = 0;
function yon(i) { const v = new Array(384).fill(0); v[i] = 1; return v; }
function vekMetin(s) { return JSON.parse(s); }
function kosinus(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; }

/* Metne göre sahte embedding: "ssl" → eksen 0, "fiyat" → eksen 1, diğer → eksen 2. */
function sahteVektor(metin) {
  const m = String(metin).toLowerCase();
  if (m.indexOf('ssl') !== -1) return yon(0);
  if (m.indexOf('fiyat') !== -1) return yon(1);
  return yon(2);
}

/* ---------- fetch saplaması ---------- */
const istekler = { embed: [], resend: [], deepseek: [], rpc: [], ceviri: [] };
let embedDurum = 200;
let ceviriDurum = 200;
let ceviriBos = false;
/* Başlık hemen gelir, gövde ancak istek iptal edilince biter (DeepSeek'in
   cevap hazır olana dek keep-alive satırı yollaması). */
let ceviriAsili = false;
let embedAsili = false;
const asiliSinyaller = [];
function asiliCevap(sinyal) {
  asiliSinyaller.push(sinyal);
  return { ok: true, status: 200, json: function () {
    return new Promise(function (_, red) {
      sinyal.addEventListener('abort', function () { red(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
    });
  } };
}
let akisSirasindaKapat = null;
let embedSirasindaKapat = null;
let resendDurum = 200;
global.fetch = async function (adres, sec) {
  const govde = sec && sec.body ? JSON.parse(sec.body) : null;
  const cevap = function (veri, durum) {
    return { ok: (durum || 200) < 400, status: durum || 200, json: async () => veri, text: async () => JSON.stringify(veri) };
  };
  if (adres.indexOf('/functions/v1/embed') !== -1 || adres.indexOf('/embeddings') !== -1) {
    istekler.embed.push({ adres: adres, headers: sec.headers, govde: govde });
    if (embedSirasindaKapat && govde.input[0].indexOf('adımları izleyin') !== -1) { db.prefs[embedSirasindaKapat] = false; embedSirasindaKapat = null; }
    if (embedAsili) return asiliCevap(sec.signal);
    if (embedDurum !== 200) return cevap({ error: 'x' }, embedDurum);
    return cevap({ data: govde.input.map(function (t, i) { return { index: i, embedding: sahteVektor(t) }; }) });
  }
  if (adres.indexOf('api.resend.com') !== -1) {
    istekler.resend.push({ headers: sec.headers, govde: govde });
    return resendDurum === 200 ? cevap({ id: 'em_' + istekler.resend.length }) : cevap({}, resendDurum);
  }
  /* Akışsız DeepSeek isteği = embedding öncesi çeviri. Sahte çeviri metni
     "EN: " önekiyle döndürür (anahtar kelimeler korunur, sahteVektor çalışır). */
  if (adres.indexOf('deepseek') !== -1 && govde.stream === false) {
    istekler.ceviri.push({ adres: adres, govde: govde });
    if (ceviriAsili) return asiliCevap(sec.signal);
    if (ceviriDurum !== 200) return cevap({ error: 'x' }, ceviriDurum);
    const metin = ceviriBos ? '   ' : 'EN: ' + govde.messages[1].content;
    return cevap({ choices: [{ message: { role: 'assistant', content: metin } }] });
  }
  if (adres.indexOf('deepseek') !== -1) {
    istekler.deepseek.push(govde);
    if (akisSirasindaKapat) { db.prefs[akisSirasindaKapat] = false; akisSirasindaKapat = null; }
    const enc = new TextEncoder();
    const parca = ['data: ' + JSON.stringify({ choices: [{ delta: { content: 'Şu adımları izleyin.' } }] }) + '\n\n',
      'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'];
    let i = 0;
    return { ok: true, status: 200, body: new ReadableStream({ pull(c) { if (i < parca.length) c.enqueue(enc.encode(parca[i++])); else c.close(); } }) };
  }
  if (adres.indexOf('sahte.supabase.co/rest/v1/') !== -1) {
    const u = new URL(adres);
    const yol = u.pathname.replace('/rest/v1/', '');
    const p = u.searchParams;
    const yontem = sec.method || 'GET';
    if (yol === 'rpc/cl_match_assistant_messages') {
      istekler.rpc.push(govde);
      const q = vekMetin(govde.p_query);
      const liste = db.messages.filter(function (m) {
        return m.user_id === govde.p_user_id && m.embedding && (govde.p_before_id === null || m.id < govde.p_before_id);
      }).map(function (m) { return Object.assign({}, m, { similarity: kosinus(vekMetin(m.embedding), q) }); })
        .filter(function (m) { return m.similarity >= 0.3; })
        .sort(function (a, b) { return b.similarity - a.similarity; }).slice(0, govde.p_limit);
      return cevap(liste.map(function (m) { return { id: m.id, role: m.role, content: m.content, created_at: m.created_at, similarity: m.similarity }; }));
    }
    if (yol === 'rpc/cl_append_assistant_messages') {
      istekler.append = (istekler.append || 0) + 1;
      if (db.prefs[govde.p_user_id] !== true) return cevap(0);
      govde.p_rows.forEach(function (r) {
        sira += 1;
        const satir = { id: sira, created_at: '2026-10-' + String(sira).padStart(2, '0') + 'T10:00:00Z', user_id: govde.p_user_id, role: r.role, content: r.content };
        if (r.embedding !== null) satir.embedding = r.embedding;
        db.messages.push(satir);
      });
      return cevap(govde.p_rows.length);
    }
    if (yol === 'cl_user_prefs') {
      const uid = (p.get('user_id') || '').replace('eq.', '');
      if (yontem === 'GET') return cevap(db.prefs[uid] === undefined ? [] : [{ remember_me: db.prefs[uid] }]);
      db.prefs[govde.user_id] = govde.remember_me; return cevap(null, 201);
    }
    if (yol === 'cl_assistant_messages') {
      const uid = (p.get('user_id') || '').replace('eq.', '');
      if (yontem === 'POST') {
        /* Gerçek PostgREST gibi: toplu eklemede anahtarlar eşit olmalı (PGRST102). */
        const anahtar0 = Object.keys(govde[0]).sort().join(',');
        if (govde.some(function (r) { return Object.keys(r).sort().join(',') !== anahtar0; })) {
          return cevap({ code: 'PGRST102', message: 'All object keys must match' }, 400);
        }
        govde.forEach(function (r) { sira += 1; db.messages.push(Object.assign({ id: sira, created_at: '2026-10-' + String(sira).padStart(2, '0') + 'T10:00:00Z' }, r)); });
        return cevap(null, 201);
      }
      if (yontem === 'GET') {
        let l = db.messages.filter(function (m) { return m.user_id === uid; }).sort(function (a, b) { return b.id - a.id; });
        if (p.get('offset')) l = l.slice(Number(p.get('offset')));
        if (p.get('limit')) l = l.slice(0, Number(p.get('limit')));
        return cevap(l.map(function (m) { return { id: m.id, role: m.role, content: m.content, created_at: m.created_at }; }));
      }
      if (yontem === 'DELETE') {
        const silinen = db.messages.filter(function (m) { return m.user_id === uid; });
        db.messages = db.messages.filter(function (m) { return m.user_id !== uid; });
        return cevap(silinen.map(function (m) { return { id: m.id }; }));
      }
    }
    if (yol === 'cl_deletion_certificates') { db.certs.push(govde); return cevap(null, 201); }
    if (yol === 'cl_subscriptions') {
      const uid = (p.get('user_id') || '').replace('eq.', '');
      if (db.subs[uid] === 'HATA') return cevap({}, 500);
      return cevap(db.subs[uid] ? [{ plan: db.subs[uid], active: true }] : []);
    }
    if (yol === 'monitor_alerts') return cevap(db.alerts);
    return cevap([], 200);
  }
  throw new Error('beklenmeyen istek ' + adres);
};

/* ---------- Kimlik, depo, Telegram ---------- */
let oturum = null;
const kilit = {};
let depoVar = true;
sapla('_lib/auth.js', {
  isConfigured: () => true, adminConfigured: () => true,
  resolveUser: async () => oturum ? { id: oturum, email: oturum === A ? 'a@ornek.com' : 'b@ornek.com', accessToken: 't' } : null,
  adminGetUserEmail: async (id) => id === A ? 'a@ornek.com' : id === B ? 'b@ornek.com' : null,
  adminDeleteUser: async () => ({ ok: true, status: 200 }), clearSessionCookies: () => {}
});
sapla('_lib/store.js', {
  isConfigured: () => depoVar,
  hitRateLimit: async () => ({ count: 1, ttl: 60 }),
  reserveQuota: async () => ({ ok: true, used: 1 }), refundQuota: async () => {},
  setOnce: async (k) => { if (kilit[k]) return false; kilit[k] = true; return true; }
});
const gercekTg = require(path.join(API, '_lib', 'telegram.js'));
sapla('_lib/telegram.js', Object.assign({}, gercekTg, { sendTelegram: async () => ({ ok: true }), tekSefer: async () => true }));

const embed = require(path.join(API, '_lib', 'embed.js'));
const memory = require(path.join(API, '_lib', 'memory.js'));
const mailer = require(path.join(API, '_lib', 'mailer.js'));
const offer = require(path.join(API, '_lib', 'offer.js'));
const monitor = require(path.join(API, '_lib', 'monitor.js'));
const digest = require(path.join(API, 'cron', 'morning-digest.js'));
const ucAi = require(path.join(API, 'assistant-ai.js'));
const ucDelete = require(path.join(API, 'user', 'delete.js'));

function cevap() {
  const res = {
    statusCode: 200, body: null, headers: {}, yazilan: '', writableEnded: false,
    setHeader: function (k, v) { res.headers[k] = v; },
    status: function (c) { res.statusCode = c; return res; },
    json: function (b) { res.body = b; res.writableEnded = true; return res; },
    write: function (s) { res.yazilan += s; }, end: function () { res.writableEnded = true; },
    flushHeaders: function () {}, on: function () {}
  };
  return res;
}
function olaylar(metin) {
  return metin.split('\n\n').filter(Boolean).map(function (b) {
    const s = b.split('\n'); return { event: s[0].slice(7), data: JSON.parse(s[1].slice(6)) };
  });
}
async function sor(mesaj, ip) {
  const res = cevap();
  await ucAi({ method: 'POST', headers: { origin: 'https://www.cyberlionai.com', 'x-real-ip': ip || '203.0.113.1' },
    body: { message: mesaj, consent: ucAi.CONSENT_VERSION, lang: 'tr' } }, res);
  return olaylar(res.yazilan);
}

async function main() {
  /* ================= embed.js ================= */
  const v = await embed.embed(['SSL nedir', 'fiyat']);
  esit('embed iki vektör, sıra korunur', [v.length, v[0][0], v[1][1]], [2, 1, 1]);
  const e0 = istekler.embed[0];
  dogru('varsayılan sağlayıcı Supabase Edge Function', e0.adres === 'https://sahte.supabase.co/functions/v1/embed');
  esit('embed sırrı başlıkta', e0.headers['x-cl-embed-secret'], process.env.EMBED_SHARED_SECRET);
  dogru('supabase isteğinde model/dimensions yok', e0.govde.model === undefined && e0.govde.dimensions === undefined);
  esit('pgvector metni', embed.toPg([0.5, 1]), '[0.5000000,1.000000]');

  /* Çevir ve vektörleştir: gte-small yalnızca İngilizce. */
  esit('embed\'e çeviri gider, sıra korunur', e0.govde.input, ['EN: SSL nedir', 'EN: fiyat']);
  esit('metin başına bir çeviri isteği', istekler.ceviri.length, 2);
  const c0 = istekler.ceviri[0];
  dogru('çeviri DeepSeek /chat/completions, akışsız, flash, sıcaklık 0',
    c0.adres === 'https://api.deepseek.com/chat/completions' && c0.govde.stream === false
    && c0.govde.model === 'deepseek-flash' && c0.govde.temperature === 0);
  dogru('çeviride düşünme kapalı', c0.govde.thinking.type === 'disabled' && c0.govde.reasoning_effort === 'none');
  dogru('çeviri talimatı sistemde, metin kullanıcıda',
    /Translate the following text to English for semantic search/.test(c0.govde.messages[0].content)
    && c0.govde.messages[1].content === 'SSL nedir');
  dogru('çeviri sohbet isteklerine karışmaz', istekler.deepseek.length === 0);

  ceviriDurum = 503;
  const yedekV = await embed.embed(['SSL kurulumu']);
  esit('çeviri düşerse özgün metin vektörleşir, hata yok',
    [istekler.embed[istekler.embed.length - 1].govde.input, yedekV[0][0]], [['SSL kurulumu'], 1]);
  ceviriDurum = 200;
  ceviriBos = true;
  await embed.embed(['fiyat nedir']);
  esit('boş çeviri → özgün metin', istekler.embed[istekler.embed.length - 1].govde.input, ['fiyat nedir']);
  ceviriBos = false;

  /* Süre sınırı gövdeyi de kapsar (PR #105 inceleme bulgusu): başlık gelip
     gövde gelmezse çağrı takılmaz. Düzeltme yoksa bekçi 2 sn'de keser. */
  const bekci = function (p) {
    return Promise.race([p, new Promise(function (ok) { setTimeout(function () { ok('TAKILDI'); }, 2000); })]);
  };
  const eskiSure = Object.assign({}, embed.LIMITS);
  embed.LIMITS.translateTimeoutMs = 50; embed.LIMITS.timeoutMs = 50;
  ceviriAsili = true;
  let t0 = Date.now();
  const asiliV = await bekci(embed.embed(['SSL asılı']));
  ceviriAsili = false;
  esit('çeviri gövdesi gelmezse süre dolar, özgün metinle devam',
    [asiliV === 'TAKILDI' ? 'TAKILDI' : 'bitti', istekler.embed[istekler.embed.length - 1].govde.input], ['bitti', ['SSL asılı']]);
  dogru('asılı çeviri süre sınırında kesilir', Date.now() - t0 < 1000);
  dogru('asılı çeviri bağlantısı iptal edilir', asiliSinyaller[asiliSinyaller.length - 1].aborted);
  embedAsili = true;
  t0 = Date.now();
  const asiliE = await bekci(embed.embed(['SSL']).then(function () { return 'ok'; }, function (e) { return e.message; }));
  embedAsili = false;
  esit('embed gövdesi gelmezse embed_timeout', asiliE, 'embed_timeout');
  dogru('asılı embed süre sınırında kesilir', Date.now() - t0 < 1000);
  Object.assign(embed.LIMITS, eskiSure);

  /* requireTranslation (tools/embed-backfill.js): çevirisiz vektör üretmez. */
  ceviriDurum = 503;
  let embedOnce = istekler.embed.length;
  let katiHata = null;
  try { await embed.embed(['SSL kalıcı'], { requireTranslation: true }); } catch (e) { katiHata = e.message; }
  esit('kati mod: çeviri düşerse fırlatır, embed çağrılmaz', [katiHata, istekler.embed.length - embedOnce], ['embed_translate_required', 0]);
  ceviriDurum = 200;
  const katiV = await embed.embed(['SSL kalıcı'], { requireTranslation: true });
  esit('kati mod: çeviri varsa çeviriden vektör', [katiV.length, istekler.embed[istekler.embed.length - 1].govde.input], [1, ['EN: SSL kalıcı']]);
  const dsYok = process.env.DEEPSEEK_API_KEY; delete process.env.DEEPSEEK_API_KEY;
  katiHata = null;
  try { await embed.embed(['SSL'], { requireTranslation: true }); } catch (e) { katiHata = e.message; }
  esit('kati mod: DeepSeek anahtarı yoksa fırlatır', katiHata, 'embed_translate_required');
  process.env.DEEPSEEK_API_KEY = dsYok;

  let say = istekler.ceviri.length;
  process.env.EMBED_TRANSLATE = 'off';
  await embed.embed(['SSL']);
  esit('EMBED_TRANSLATE=off → çeviri yok', [istekler.ceviri.length - say, istekler.embed[istekler.embed.length - 1].govde.input], [0, ['SSL']]);
  delete process.env.EMBED_TRANSLATE;
  const dsAnahtar = process.env.DEEPSEEK_API_KEY; delete process.env.DEEPSEEK_API_KEY;
  await embed.embed(['SSL']);
  esit('DeepSeek anahtarı yoksa çeviri yok, embedding sürer', [istekler.ceviri.length - say, istekler.embed[istekler.embed.length - 1].govde.input], [0, ['SSL']]);
  process.env.DEEPSEEK_API_KEY = dsAnahtar;

  process.env.EMBEDDING_PROVIDER = 'openai';
  process.env.EMBEDDING_API_KEY = 'sk-openai-test-key-0123456789';
  say = istekler.ceviri.length;
  await embed.embed(['x']);
  const e1 = istekler.embed[istekler.embed.length - 1];
  esit('openai sağlayıcısı: model + 384 boyut', [e1.adres, e1.govde.model, e1.govde.dimensions], ['https://api.openai.com/v1/embeddings', 'text-embedding-3-small', 384]);
  esit('openai çok dilli: çeviri yok', [istekler.ceviri.length - say, e1.govde.input], [0, ['x']]);
  delete process.env.EMBEDDING_PROVIDER; delete process.env.EMBEDDING_API_KEY;

  embedDurum = 500;
  let hata = null; try { await embed.embed(['x']); } catch (e) { hata = e.message; }
  esit('embed HTTP hatası', hata, 'embed_http_500');
  embedDurum = 200;
  const eskiSir = process.env.EMBED_SHARED_SECRET; delete process.env.EMBED_SHARED_SECRET;
  esit('sır yoksa yapılandırılmamış', embed.isConfigured(), false);
  process.env.EMBED_SHARED_SECRET = '  ' + eskiSir + '\n';
  await embed.embed(['SSL']);
  esit('sırdaki boşluk/satır sonu kırpılır', istekler.embed[istekler.embed.length - 1].headers['x-cl-embed-secret'], eskiSir);
  process.env.EMBED_SHARED_SECRET = eskiSir;

  /* ================= Anlamsal hafıza ↔ asistan ================= */
  db.prefs[A] = true;
  /* Eski konuşmalar: 1-2 SSL, 3-10 alakasız (son mesaj penceresi bunları kapsar). */
  await memory.appendMessages(A, [
    { role: 'user', content: 'SSL sertifikam bitti ne yapayım', embedding: yon(0) },
    { role: 'assistant', content: 'Certbot ile yenileyin', embedding: yon(0) }
  ]);
  for (let i = 0; i < 8; i += 1) await memory.appendMessages(A, [{ role: 'user', content: 'alakasız ' + i, embedding: yon(2) }]);

  oturum = A;
  let ev = await sor('SSL yine sorun çıkardı');
  const giden = istekler.deepseek[istekler.deepseek.length - 1].messages;
  dogru('anlamsal eşleşme tarih etiketiyle gider', giden[1].content.indexOf('[Önceki konuşma · 2026-10-01] SSL sertifikam bitti') === 0);
  dogru('eşleşen cevap da gider', giden.some(function (m) { return m.content.indexOf('Certbot ile yenileyin') !== -1; }));
  const rpc = istekler.rpc[istekler.rpc.length - 1];
  esit('arama son 6 mesajdan eskilerle sınırlı', rpc.p_before_id, 5);
  esit('meta recalled', ev[0].data.recalled, 2);
  const yazilan = db.messages.slice(-2);
  dogru('soru vektörüyle saklandı', JSON.parse(yazilan[0].embedding)[0] === 1);
  dogru('cevap vektörüyle saklandı', typeof yazilan[1].embedding === 'string');

  /* Karışık vektör: soru vektörlü, cevabın embedding'i düşerse iki satır da
     yazılmalı (inceleme bulgusu: eşit olmayan anahtarlar ikisini de düşürüyordu). */
  const onceKarisik = db.messages.length;
  await memory.appendMessages(A, [{ role: 'user', content: 'vektörlü', embedding: yon(0) }, { role: 'assistant', content: 'vektörsüz' }]);
  esit('karışık vektörlü toplu ekleme iki satırı da yazar', db.messages.length - onceKarisik, 2);
  esit('vektörsüz satırda embedding null', db.messages[db.messages.length - 1].embedding, null);

  /* Akış sürerken "unut beni": cevap bitince hiçbir şey yazılmamalı. */
  const onceKapat = db.messages.filter(function (m) { return m.user_id === A; }).length;
  akisSirasindaKapat = A;
  await sor('SSL hafıza yarışı');
  esit('akış sırasında hafıza kapatılırsa yazılmaz (inceleme bulgusu)', db.messages.filter(function (m) { return m.user_id === A; }).length, onceKapat);
  db.prefs[A] = true;
  /* Cevabın embedding'i beklenirken "unut beni" (inceleme 2. tur). */
  embedSirasindaKapat = A;
  await sor('SSL embedding yarışı');
  esit('cevap embedding beklenirken hafıza kapatılırsa yazılmaz', db.messages.filter(function (m) { return m.user_id === A; }).length, onceKapat);
  db.prefs[A] = true;

  embedDurum = 500;
  const onceSay = istekler.deepseek.length;
  ev = await sor('SSL tekrar');
  const giden2 = istekler.deepseek[onceSay].messages;
  dogru('embedding düşünce asistan durmaz', ev.some(function (e) { return e.event === 'done'; }));
  dogru('embedding düşünce etiket yok, son mesajlar gider', !giden2.some(function (m) { return m.content.indexOf('[Önceki konuşma') === 0; }) && giden2.length > 2);
  dogru('embedding düşünce mesaj vektörsüz yazılır', db.messages[db.messages.length - 2].embedding === undefined);
  dogru('asistan hafızaya atomik RPC ile yazar', istekler.append > 0);
  embedDurum = 200;

  /* ================= mailer ================= */
  const anahtar = process.env.RESEND_API_KEY;
  esit('mail yapılandırılmamış', await mailer.send({ to: 'a@ornek.com', subject: 's', text: 't' }), { ok: false, code: 'mail_unconfigured' });
  esit('yapılandırılmamışken istek yok', istekler.resend.length, 0);
  oturum = B; db.prefs[B] = true;
  await memory.appendMessages(B, [{ role: 'user', content: 'x' }]);
  let res = cevap();
  await ucDelete({ method: 'POST', headers: {}, body: { scopes: ['conversations'] } }, res);
  esit('mail yoksa silme başarılı, durum unconfigured', [res.statusCode, res.body.mail, Boolean(res.body.certificate)], [200, 'unconfigured', true]);

  process.env.RESEND_API_KEY = 're_test_0123456789';
  process.env.MAIL_FROM = 'Cyber Lion AI <bildirim@cyberlionai.com>';
  res = cevap();
  await ucDelete({ method: 'POST', headers: {}, body: { scopes: ['conversations'] } }, res);
  esit('mail varsa gönderildi', res.body.mail, 'sent');
  const r0 = istekler.resend[0];
  esit('Resend isteği', [r0.headers.Authorization, r0.govde.to, r0.govde.from], ['Bearer re_test_0123456789', ['b@ornek.com'], 'Cyber Lion AI <bildirim@cyberlionai.com>']);
  dogru('e-postada sertifika kodu', r0.govde.text.indexOf('#' + res.body.certificate) !== -1 && r0.govde.html.indexOf(res.body.certificate) !== -1);
  resendDurum = 403;
  res = cevap();
  await ucDelete({ method: 'POST', headers: {}, body: { scopes: ['conversations'] } }, res);
  esit('Resend reddederse failed, sertifika yine yanıtta', [res.body.mail, Boolean(res.body.certificate)], ['failed', true]);
  resendDurum = 200;
  esit('kötü alıcı', (await mailer.send({ to: 'a@b', subject: 's', text: 't' })).code, 'mail_bad_recipient');
  dogru('HTML kaçışı', mailer.certificateEmail('DEL-<b>', ['conversations']).html.indexOf('<b>') === -1);

  /* ================= Teklif ================= */
  const o = offer.buildOffer('tr');
  dogru('teklif fiyatı plans.js', o.text.indexOf('₺299/ay') !== -1 && o.text.indexOf('₺358,80') !== -1);
  dogru('teklifte yanıltıcı vaat yok', !/29\s*\$|\$\s*29|otomatik (olarak )?kapat|7\/24|tam otomatik/i.test(o.text + offer.buildOffer('en').text));
  esit('teklif adresi', o.url, '/odeme?plan=pro');

  oturum = null;
  ev = await sor('Bu XSS açığını nasıl kapatırım?', '198.51.100.1');
  const sira1 = ev.map(function (e) { return e.event; });
  esit('anonim + düzeltme niyeti: teklif cevaptan sonra, done öncesi', sira1, ['meta', 'delta', 'offer', 'done']);
  ev = await sor('Bu XSS açığını nasıl kapatırım?', '198.51.100.1');
  dogru('24 saatte bir', !ev.some(function (e) { return e.event === 'offer'; }));
  ev = await sor('HSTS nedir?', '198.51.100.2');
  dogru('tanım sorusunda teklif yok', !ev.some(function (e) { return e.event === 'offer'; }));

  oturum = A; db.subs[A] = 'pro';
  ev = await sor('Bu açığı nasıl düzeltirim?');
  dogru('ücretli kullanıcıya teklif yok', !ev.some(function (e) { return e.event === 'offer'; }));
  db.subs[A] = 'HATA';
  esit('plan okunamazsa teklif yok', await offer.decideOffer({ message: 'nasıl kapatırım', finishReason: 'stop', userId: A, who: 'x', lang: 'tr' }), null);
  delete db.subs[A];
  esit('yanıt yarıda kaldıysa teklif yok', await offer.decideOffer({ message: 'nasıl kapatırım', finishReason: 'interrupted', userId: null, who: 'y', lang: 'tr' }), null);
  process.env.AI_SALES_MODE = 'off';
  esit('satış modu kapalı', await offer.decideOffer({ message: 'nasıl kapatırım', finishReason: 'stop', userId: null, who: 'z', lang: 'tr' }), null);
  delete process.env.AI_SALES_MODE;
  depoVar = false;
  esit('depo yoksa teklif yok (sınır uygulanamaz)', await offer.decideOffer({ message: 'nasıl kapatırım', finishReason: 'stop', userId: null, who: 'w', lang: 'tr' }), null);
  depoVar = true;

  /* ================= Yeni bulgu ================= */
  const once = new Set(['high|Eksik HSTS', 'low|Sunucu başlığı']);
  const simdi = [
    { severity: 'high', title: 'Eksik HSTS' },
    { severity: 'critical', title: 'Açık .git dizini' },
    { severity: 'medium', title: 'CSP yok' },
    { severity: 'medium', title: 'CSP yok' },
    { severity: 'low', title: 'Çerez bayrağı' }
  ];
  esit('yalnız yeni ve önemli bulgular', monitor.newFindings(once, simdi).map(function (f) { return f.title; }), ['Açık .git dizini', 'CSP yok']);
  esit('ilk taramada taban yok', monitor.newFindings(null, simdi), []);

  /* ================= Sabah özeti ================= */
  db.alerts = [
    { user_id: A, domain: 'a.com', kind: 'new_findings', severity: 'critical', data: { count: 1, first: 'Açık .git dizini' }, created_at: 'x' },
    { user_id: A, domain: 'a.com', kind: 'ssl_expiry', severity: 'warning', data: { daysLeft: 7 }, created_at: 'x' },
    { user_id: B, domain: 'b.com', kind: 'score_drop', severity: 'warning', data: { from: 90, to: 70 }, created_at: 'x' },
    { user_id: 'kotu-id', domain: 'c.com', kind: 'blacklist', severity: 'critical', data: {}, created_at: 'x' }
  ];
  const onceMail = istekler.resend.length;
  let out = await digest.run(Date.parse('2026-10-22T03:00:00Z'));
  esit('özet: kullanıcı başına bir e-posta', [out.users, out.sent], [2, 2]);
  const ozetA = istekler.resend.slice(onceMail).find(function (r) { return r.govde.to[0] === 'a@ornek.com'; }).govde;
  dogru('özette ölçülen olaylar', ozetA.text.indexOf('Açık .git dizini') !== -1 && ozetA.text.indexOf('7 gün kaldı') !== -1);
  dogru('özette kritik işareti', ozetA.subject.indexOf('⚠️') === 0);
  dogru('özette uydurma olay yok', !/saldırı engellendi|brute|eklenti güncelle/i.test(ozetA.text + ozetA.html));
  out = await digest.run(Date.parse('2026-10-22T03:30:00Z'));
  esit('aynı gün ikinci koşu göndermez', [out.sent, out.skipped], [0, 2]);

  res = cevap();
  delete process.env.CRON_SECRET;
  await digest({ method: 'GET', headers: {} }, res);
  esit('cron sırrı yoksa kapalı', res.statusCode, 503);
  process.env.CRON_SECRET = 'cron-sirri';
  res = cevap();
  await digest({ method: 'GET', headers: { authorization: 'Bearer yanlis' } }, res);
  dogru('yanlış cron sırrı reddedilir', res.statusCode === 401 || res.statusCode === 403);
  delete process.env.RESEND_API_KEY;
  res = cevap();
  await digest({ method: 'GET', headers: { authorization: 'Bearer cron-sirri' } }, res);
  esit('mail yoksa özet atlanır', res.body, { ok: true, skipped: 'mail_unconfigured' });
  process.env.RESEND_API_KEY = anahtar;

  if (hatalar.length) {
    console.error('BAŞARISIZ (' + hatalar.length + '):\n  - ' + hatalar.join('\n  - '));
    process.exit(1);
  }
  console.log('proactive: ' + gecti + ' doğrulama geçti');
}

main().catch(function (e) { console.error(e); process.exit(1); });
