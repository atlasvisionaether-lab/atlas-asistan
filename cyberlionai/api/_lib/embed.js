'use strict';

/**
 * Metin → 384 boyutlu vektör (asistan hafızasının anlamsal araması).
 *
 *   embed(texts[])  → number[384][]   (sıra korunur)
 *   isConfigured()  → boolean
 *
 * SAĞLAYICI (EMBEDDING_PROVIDER)
 *   supabase  (varsayılan) Supabase Edge Function `embed`, model gte-small.
 *             Metin Supabase dışına çıkmaz; yeni veri işleyen yok.
 *             Gerekli: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EMBED_SHARED_SECRET
 *   openai    OpenAI uyumlu /embeddings ucu (ör. text-embedding-3-small).
 *             Gerekli: EMBEDDING_API_KEY; ops. EMBEDDING_BASE_URL, EMBEDDING_MODEL.
 *             İstek `dimensions: 384` ile yapılır (sütun boyutu sabit).
 *             DİKKAT: bu yeni bir veri işleyendir; seçilirse gizlilik
 *             politikası ve veri kataloğu güncellenmeli.
 *
 * DeepSeek'in embedding ucu yok (dokümanında yalnızca chat/completions var),
 * bu yüzden seçenek değil.
 *
 * ÇEVİR VE VEKTÖRLEŞTİR (yalnızca supabase sağlayıcısı)
 *   gte-small yalnızca İngilizce: canlı ölçümde Türkçe sorguda ilgisiz metin
 *   ilgili metnin önüne geçti (fark −0.007), İngilizcede doğru sonuç 0.159
 *   farkla öndeydi. Çok dilli multilingual-e5-small Edge Function'da
 *   WORKER_RESOURCE_LIMIT ile düştü. Bu yüzden her metin önce DeepSeek flash
 *   ile İngilizceye çevrilir, vektör çeviriden alınır. Soru da saklanan
 *   mesajlar da aynı yoldan geçer; karşılaştırma İngilizce↔İngilizce olur.
 *   DeepSeek zaten asistanın birincil sağlayıcısı ve metin zaten maskeli
 *   (ai-redact): yeni veri işleyen eklenmez. Çeviri düşerse (anahtar yok,
 *   zaman aşımı, boş cevap) özgün metin kullanılır; arama zayıflar, durmaz.
 *   EMBED_TRANSLATE=off ile kapanır. Çevrilen metin hiçbir yere yazılmaz;
 *   veritabanına mesajın özgün (maskeli) hâli girer.
 *
 * Hata hâlinde fırlatır; çağıran (assistant-ai) hafızayı "son mesajlar"
 * moduna düşürür, asistan durmaz. Anahtarlar loglanmaz.
 */

const llm = require('./llm');

const DIM = 384;
const MAX_INPUTS = 16;
const MAX_CHARS = 2000;
/* Süreler isteğin TAMAMINI kapsar (başlık + gövde); sınama kısaltabilsin
   diye nesnede. */
const LIMITS = { timeoutMs: 8000, translateTimeoutMs: 6000 };
/* 2000 karakterlik Türkçe metnin İngilizcesi ~600 token; pay bırakıldı. */
const TRANSLATE_MAX_TOKENS = 1200;
const TRANSLATE_SYSTEM = 'Translate the following text to English for semantic search purposes. '
  + 'Output only the translation, with no notes or quotes. If the text is already in English, '
  + 'return it unchanged. Keep bracketed placeholders such as [e-posta], [ip] or [gizli] exactly as they are.';

function translator(provider) {
  if (provider !== 'supabase') return null;
  if (String(process.env.EMBED_TRANSLATE || '').toLowerCase() === 'off') return null;
  return llm.config().deepseek;
}

/* JSON POST; süre sınırı gövde okunana kadar sürer. fetch başlıklar gelince
   döner: zamanlayıcı orada temizlenirse, başlığı erken gönderip gövdeyi
   bekleten uç (DeepSeek akışsız istekte yük altında cevap hazır olana dek
   boş keep-alive satırları yollar) res.json()'u süresiz bekletir ve hafıza
   araması, dolayısıyla asistan yanıtı takılır (PR #105 inceleme bulgusu).
   Hata kodları: <önek>_unreachable | _timeout | _http_<durum> | _bad_response. */
async function postJson(url, headers, body, timeoutMs, prefix) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(function () { timedOut = true; ctrl.abort(); }, timeoutMs);
  try {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body), signal: ctrl.signal });
    } catch (err) {
      throw new Error(prefix + (timedOut ? '_timeout' : '_unreachable'));
    }
    if (!res.ok) throw new Error(prefix + '_http_' + res.status);
    try {
      return await res.json();
    } catch (err) {
      throw new Error(prefix + (timedOut ? '_timeout' : '_bad_response'));
    }
  } finally {
    clearTimeout(timer);
    /* Okunmadan bırakılan gövdenin (hata durumu) bağlantısı açık kalmasın. */
    ctrl.abort();
  }
}

/* Tek metni İngilizceye çevirir; başarısızlıkta fırlatır. Akışsız istek:
   kısa metin, ilk-token yedeği gerekmiyor. */
async function toEnglish(ds, text) {
  const json = await postJson(ds.base + '/chat/completions',
    { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ds.key },
    {
      model: ds.models.flash,
      stream: false,
      max_tokens: TRANSLATE_MAX_TOKENS,
      temperature: 0,
      thinking: { type: 'disabled' },
      reasoning_effort: 'none',
      messages: [{ role: 'system', content: TRANSLATE_SYSTEM }, { role: 'user', content: text }]
    },
    LIMITS.translateTimeoutMs, 'translate');
  const choice = json && json.choices && json.choices[0];
  const out = choice && choice.message && typeof choice.message.content === 'string' ? choice.message.content.trim() : '';
  if (!out) throw new Error('translate_empty');
  return out.slice(0, MAX_CHARS);
}

/* Metinleri paralel çevirir; düşen metin özgün hâliyle kalır. Metin loglanmaz. */
async function translateAll(ds, texts, strict) {
  return Promise.all(texts.map(function (t) {
    return toEnglish(ds, t).catch(function (err) {
      console.error(JSON.stringify({ ev: 'embed_translate_fail', code: String(err && err.message).slice(0, 40) }));
      /* strict: kalıcı yazım (tools/embed-backfill.js) çevirisiz vektörü
         kabul etmez; canlı yol ise özgün metinle sürer. */
      if (strict) throw new Error('embed_translate_required');
      return t;
    });
  }));
}

function config() {
  const env = process.env;
  const provider = (env.EMBEDDING_PROVIDER || 'supabase').toLowerCase();
  if (provider === 'openai') {
    const key = env.EMBEDDING_API_KEY;
    if (!key || key.length < 20) return null;
    return {
      provider: 'openai',
      url: String(env.EMBEDDING_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/embeddings',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      model: env.EMBEDDING_MODEL || 'text-embedding-3-small'
    };
  }
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  /* Panele yapıştırılan değerde sondaki boşluk/satır sonu, Edge Function'ın
     sabit zamanlı karşılaştırmasında 401 demek (canlıda 2026-10-21). */
  const secret = String(env.EMBED_SHARED_SECRET || '').trim();
  if (!url || !key || !secret || secret.length < 16) return null;
  return {
    provider: 'supabase',
    url: url.replace(/\/+$/, '') + '/functions/v1/embed',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'x-cl-embed-secret': secret },
    model: 'gte-small'
  };
}

function isConfigured() { return config() !== null; }

function validVector(v) {
  return Array.isArray(v) && v.length === DIM && v.every(function (x) { return typeof x === 'number' && isFinite(x); });
}

/* opts.requireTranslation: çeviri yapılamazsa (anahtar yok ya da çeviri
   düştü) vektör üretmek yerine fırlatır. */
async function embed(texts, opts) {
  const strict = Boolean(opts && opts.requireTranslation);
  const cfg = config();
  if (!cfg) throw new Error('embed_unconfigured');
  const input = (texts || []).map(function (t) { return String(t || '').slice(0, MAX_CHARS); });
  if (!input.length || input.length > MAX_INPUTS || input.some(function (t) { return !t.trim(); })) {
    throw new Error('embed_bad_input');
  }

  const ds = translator(cfg.provider);
  if (strict && !ds) throw new Error('embed_translate_required');
  const body = { input: ds ? await translateAll(ds, input, strict) : input };
  if (cfg.provider === 'openai') { body.model = cfg.model; body.dimensions = DIM; }

  const json = await postJson(cfg.url, cfg.headers, body, LIMITS.timeoutMs, 'embed');
  const data = json && Array.isArray(json.data) ? json.data.slice() : null;
  if (!data || data.length !== input.length) throw new Error('embed_bad_response');
  data.sort(function (a, b) { return a.index - b.index; });
  const vectors = data.map(function (d) { return d && d.embedding; });
  if (!vectors.every(validVector)) throw new Error('embed_bad_vector');
  return vectors;
}

/** PostgREST'e pgvector değeri: '[0.1,0.2,…]' metni. */
function toPg(vector) {
  return '[' + vector.map(function (x) { return Number(x).toPrecision(7); }).join(',') + ']';
}

module.exports = { embed, isConfigured, toPg, DIM, LIMITS };
