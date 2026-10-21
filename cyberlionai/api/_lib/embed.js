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
 * Hata hâlinde fırlatır; çağıran (assistant-ai) hafızayı "son mesajlar"
 * moduna düşürür, asistan durmaz. Anahtarlar loglanmaz.
 */

const DIM = 384;
const TIMEOUT_MS = 8000;
const MAX_INPUTS = 16;
const MAX_CHARS = 2000;

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
  const secret = env.EMBED_SHARED_SECRET;
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

async function embed(texts) {
  const cfg = config();
  if (!cfg) throw new Error('embed_unconfigured');
  const input = (texts || []).map(function (t) { return String(t || '').slice(0, MAX_CHARS); });
  if (!input.length || input.length > MAX_INPUTS || input.some(function (t) { return !t.trim(); })) {
    throw new Error('embed_bad_input');
  }

  const body = { input: input };
  if (cfg.provider === 'openai') { body.model = cfg.model; body.dimensions = DIM; }

  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
  let res;
  try {
    res = await fetch(cfg.url, { method: 'POST', headers: cfg.headers, body: JSON.stringify(body), signal: ctrl.signal });
  } catch (err) {
    throw new Error('embed_unreachable');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error('embed_http_' + res.status);

  let json;
  try { json = await res.json(); } catch (e) { throw new Error('embed_bad_response'); }
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

module.exports = { embed, isConfigured, toPg, DIM };
