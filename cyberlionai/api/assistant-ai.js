'use strict';

/**
 * Cyber Lion AI asistanı — hibrit dil modeli ucu (akışlı).
 *
 *   GET  /api/assistant-ai
 *        → { enabled, consentVersion }        (arayüz AI katmanını açsın mı)
 *   POST /api/assistant-ai  { message, history[], lang, consent }
 *        → text/event-stream:
 *            event: meta      { tier, provider, model, fallback, redacted }
 *            event: thinking  {}                         (pro modeli düşünüyor)
 *            event: delta     { t }                      (metin parçası)
 *            event: done      { finishReason }           (stop|max_tokens|interrupted)
 *            event: error     { code }
 *        Ön koşul hataları (rıza, hız sınırı, kapalı katman) düz JSON döner.
 *
 * NEDEN AYRI UÇ
 *
 * `/api/assistant` deterministik bilgi tabanı: fiyat, plan, iade gibi
 * soruların TEK doğru cevabı var ve bir dil modeli bunları uydurmamalı.
 * Arayüz önce oraya soruyor; bilgi tabanı net cevap veremezse (fallback)
 * soru buraya geliyor.
 *
 * KAPALI DEVRE (fail-closed)
 *
 * Bu uç dış, ücretli bir kaynağı tüketiyor. Şunlardan biri yoksa 503 döner ve
 * hiçbir sağlayıcıya istek gitmez:
 *   - AI_ASSISTANT_ENABLED=true
 *   - en az bir sağlayıcı anahtarı (DEEPSEEK_API_KEY / ANTHROPIC_API_KEY)
 *   - hız sınırı deposu (Upstash). Depo yoksa ya da düşerse sınır
 *     uygulanamaz; sınırsız bir model ucu fatura saldırısına açık olurdu.
 *
 * AÇIK RIZA
 *
 * İstek `consent` alanında güncel rıza sürümünü (CONSENT_VERSION) taşımıyorsa
 * 428 consent_required. Metin değişirse sürüm yükseltilir; eski rıza geçersiz
 * sayılır ve arayüz yeniden sorar.
 *
 * SAĞLAYICIYA NE GİDER
 *
 * Yalnızca kullanıcının yazdığı metin ve son birkaç mesaj, `ai-redact` ile
 * maskelendikten sonra. IP, oturum, e-posta, hesap ya da tarama verisi
 * eklenmez. Loga mesaj metni yazılmaz; yalnızca katman, sağlayıcı, token
 * sayısı ve yönlendirme gerekçesi.
 */

const store = require('./_lib/store.js');
const { clientIp, ipKey } = require('./_lib/session.js');
const tg = require('./_lib/telegram.js');
const llm = require('./_lib/llm.js');
const { route } = require('./_lib/ai-router.js');
const { redact } = require('./_lib/ai-redact.js');
const { systemPrompt } = require('./_lib/ai-prompt.js');
const auth = require('./_lib/auth.js');
const memory = require('./_lib/memory.js');
const embedder = require('./_lib/embed.js');
const offers = require('./_lib/offer.js');

/* Rıza metni (index.html → assist.aiConsent*) değişirse bu sürüm yükselir.
   .2: hafıza (kayıtlı konuşmaların modele bağlam olarak gitmesi) eklendi. */
const CONSENT_VERSION = '2026-10-21.2';
/* Hafızadan modele giden bağlam: son RECENT mesaj + tüm kayıtlı geçmişten
   anlamca en yakın SEMANTIC mesaj (012, pgvector). Embedding yoksa ya da
   düşerse yalnızca son mesajlar gider (Aşama 2 davranışı). */
const MEMORY_RECENT = 6;
const MEMORY_SEMANTIC = 5;
const MEMORY_RECENT_FALLBACK = 12;

const LANGS = ['tr', 'en'];
const MAX_MESSAGE = 4000;          // log/kod yapıştırmaya yetecek kadar
const MAX_HISTORY = 8;
const MAX_HISTORY_TEXT = 2000;
const RATE_WINDOW_SECONDS = 60;
const RATE_MAX = 8;
const DAILY_MAX = 40;
const DAY_SECONDS = 86400;

const DEFAULT_ORIGINS = [
  'https://www.cyberlionai.com',
  'https://cyberlionai.com'
];

function enabled() {
  return process.env.AI_ASSISTANT_ENABLED === 'true' && llm.isConfigured();
}

function allowedOrigins() {
  const extra = String(process.env.AI_ALLOWED_ORIGINS || '')
    .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  return DEFAULT_ORIGINS.concat(extra);
}

/**
 * Başka bir sitenin bu ucu kendi ziyaretçileri adına (bizim faturamıza)
 * çağırmasını engeller. Tarayıcı POST'ta Origin'i her zaman gönderir;
 * Origin'siz istek (curl, betik) reddedilir. Bu bir kimlik doğrulaması değil:
 * asıl koruma hız sınırı ve günlük kota.
 */
function originOk(req) {
  const origin = req.headers && req.headers.origin;
  return typeof origin === 'string' && allowedOrigins().indexOf(origin) !== -1;
}

function bodyOf(req) {
  const b = req && req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string' && b) { try { return JSON.parse(b); } catch (e) { return null; } }
  return null;
}

/** İstemciden gelen geçmiş: güvenilmez; rol, sayı ve uzunluk sınırlı, maskeli. */
function cleanHistory(list) {
  if (!Array.isArray(list)) return { messages: [], redacted: 0 };
  let redacted = 0;
  const messages = list.slice(-MAX_HISTORY).map(function (h) {
    if (!h || (h.role !== 'user' && h.role !== 'assistant') || typeof h.text !== 'string') return null;
    const r = redact(h.text.slice(0, MAX_HISTORY_TEXT));
    redacted += r.count;
    return { role: h.role, content: r.text };
  }).filter(Boolean);
  return { messages: messages, redacted: redacted };
}

function sse(res, event, data) {
  res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
}

function fail(res, status, code, extra) {
  return res.status(status).json({ error: Object.assign({ code: code }, extra || {}) });
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({ enabled: enabled(), consentVersion: CONSENT_VERSION });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return fail(res, 405, 'method_not_allowed');
  }
  if (!originOk(req)) return fail(res, 403, 'origin_not_allowed');
  if (!enabled()) return fail(res, 503, 'ai_unconfigured');
  if (!store.isConfigured()) return fail(res, 503, 'store_unconfigured');

  const body = bodyOf(req);
  if (!body) return fail(res, 400, 'bad_json');
  if (body.consent !== CONSENT_VERSION) {
    return fail(res, 428, 'consent_required', { consentVersion: CONSENT_VERSION });
  }

  const raw = typeof body.message === 'string' ? body.message.trim() : '';
  if (!raw) return fail(res, 400, 'empty');
  if (raw.length > MAX_MESSAGE) return fail(res, 413, 'too_long', { max: MAX_MESSAGE });
  const lang = LANGS.indexOf(body.lang) !== -1 ? body.lang : 'tr';

  /* Hız sınırı + günlük kota. Depo hatasında istek REDDEDİLİR (bkz. üstteki
     kapalı devre notu). */
  const who = ipKey(clientIp(req));
  const quotaKey = 'cl:ai:day:' + who;
  try {
    const rate = await store.hitRateLimit('cl:rl:ai:' + who, RATE_WINDOW_SECONDS);
    if (rate.count > RATE_MAX) {
      const retryAfter = rate.ttl > 0 ? rate.ttl : RATE_WINDOW_SECONDS;
      res.setHeader('Retry-After', String(retryAfter));
      return fail(res, 429, 'rate_limited', { retryAfter: retryAfter });
    }
    const quota = await store.reserveQuota(quotaKey, DAILY_MAX, DAY_SECONDS);
    if (!quota.ok) return fail(res, 429, 'daily_limit', { limit: DAILY_MAX });
  } catch (err) {
    return fail(res, 503, 'store_unavailable');
  }

  /* Yönlendirme maskelenmemiş metinle yapılır (karar sunucuda kalıyor,
     dışarı çıkmıyor); sağlayıcıya maskeli metin gider. */
  const decision = route(raw, Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY) : []);
  const current = redact(raw);
  const past = cleanHistory(body.history);

  /* Hafıza: yalnızca giriş yapmış ve "hatırla" demiş kullanıcı. Kayıtlı
     konuşmalar (zaten maskeli) bu sohbetin istemci geçmişinin önüne eklenir.
     Hafıza okunamazsa soru hafızasız yanıtlanır; asistan durmaz. Oturum
     çözümü SSE başlıklarından ÖNCE: token tazelenirse çerez yazılabilsin. */
  let rememberUser = null;
  let sessionUserId = null;
  let stored = [];
  let recalled = 0;
  let questionVector = null;
  try {
    const user = auth.isConfigured() ? await auth.resolveUser(req, res) : null;
    sessionUserId = user ? user.id : null;
    if (user && memory.isConfigured() && await memory.getRemember(user.id) === true) {
      rememberUser = user.id;
      let semantic = [];
      if (embedder.isConfigured()) {
        const recent = await memory.loadMessages(user.id, MEMORY_RECENT);
        try {
          questionVector = (await embedder.embed([current.text]))[0];
          semantic = await memory.searchMessages(user.id, questionVector, MEMORY_SEMANTIC,
            recent.length ? recent[0].id : null);
        } catch (err) {
          console.error(JSON.stringify({ ev: 'ai_memory_search_fail', code: String(err && err.message).slice(0, 40) }));
        }
        /* Anlamsal sonuç yoksa (embedding düştü ya da eşleşme yok) daha uzun
           bir son-mesaj penceresi kullanılır. */
        stored = semantic.length ? semantic.map(function (m) {
          /* Tarih etiketi sunucunun eklediği sabit biçim; model "geçen ay"
             gibi zaman ifadesini buradan kurar. */
          return { role: m.role, content: '[Önceki konuşma · ' + String(m.createdAt || '').slice(0, 10) + '] ' + m.content };
        }).concat(recent) : await memory.loadMessages(user.id, MEMORY_RECENT_FALLBACK);
        recalled = semantic.length;
      } else {
        stored = await memory.loadMessages(user.id, MEMORY_RECENT_FALLBACK);
      }
    }
  } catch (err) {
    console.error(JSON.stringify({ ev: 'ai_memory_read_fail', code: String(err && err.message).slice(0, 40) }));
  }
  const memoryState = stored.length ? 'remembered' : 'none';
  const messages = stored.map(function (m) { return { role: m.role, content: m.content }; })
    .concat(past.messages, [{ role: 'user', content: current.text }]);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  /* Kullanıcı paneli kapatır ya da sayfadan çıkarsa sağlayıcı isteği de kesilir:
     okunmayacak bir yanıt için token harcanmasın. */
  const ctrl = new AbortController();
  res.on('close', function () { if (!res.writableEnded) ctrl.abort(); });

  const providerErrors = [];
  let started = false;
  let thinkingSent = false;
  let answer = '';
  try {
    const result = await llm.streamChat({
      tier: decision.tier,
      system: systemPrompt(lang, { memory: memoryState }),
      messages: messages,
      signal: ctrl.signal,
      onStart: function (info) {
        started = true;
        sse(res, 'meta', Object.assign({
          tier: decision.tier, provider: info.provider, model: info.model,
          fallback: info.fallback, redacted: current.count + past.redacted,
          memory: rememberUser ? 'on' : 'off'
        }, rememberUser ? { recalled: recalled } : {}));
      },
      /* Model her düşünme parçası için sinyal verir (canlı denemede ~3000);
         arayüze yalnızca BİR kez "düşünüyor" demek yeter. */
      onThinking: function () { if (!started && !thinkingSent) { thinkingSent = true; sse(res, 'thinking', {}); } },
      onDelta: function (text) { answer += text; sse(res, 'delta', { t: text }); },
      onProviderError: function (e) { providerErrors.push(e); }
    });

    /* Satış kapanışı: ücretsiz çözümden SONRA, sunucunun sabit metniyle
       (bkz. _lib/offer.js). Teklif hatası yanıtı bozmaz. */
    let offer = null;
    try {
      offer = await offers.decideOffer({
        message: raw, finishReason: result.finishReason, userId: sessionUserId, who: who, lang: lang
      });
    } catch (err) { offer = null; }
    if (offer) sse(res, 'offer', offer);
    sse(res, 'done', { finishReason: result.finishReason });

    /* Hafızaya yazma: yanıt tamamlandıysa ve kullanıcı "hatırla" dediyse.
       Kullanıcı mesajı maskeli hâliyle saklanır (modele gidenle aynı). */
    if (rememberUser && result.finishReason !== 'interrupted' && answer.trim()) {
      try {
        /* Yanıtın vektörü de saklanır; düşerse satır vektörsüz yazılır. */
        let answerVector = null;
        if (embedder.isConfigured()) {
          try { answerVector = (await embedder.embed([answer]))[0]; } catch (e) { answerVector = null; }
        }
        await memory.appendMessages(rememberUser, [
          { role: 'user', content: current.text, embedding: questionVector },
          { role: 'assistant', content: answer, embedding: answerVector }
        ]);
      } catch (err) {
        console.error(JSON.stringify({ ev: 'ai_memory_write_fail', code: String(err && err.message).slice(0, 40) }));
      }
    }
    console.log(JSON.stringify({
      ev: 'ai_assist', tier: decision.tier, reasons: decision.reasons,
      provider: result.provider, fallback: result.fallback, finish: result.finishReason,
      usage: result.usage, redacted: current.count + past.redacted,
      memory: memoryState, recalled: recalled, offer: Boolean(offer), providerErrors: providerErrors
    }));

    if (result.fallback && providerErrors.length
        && await tg.tekSefer('ai:fallback:' + providerErrors[0].code, 3600)) {
      await tg.sendTelegram('⚠️ AI asistan yedeğe geçti: ' + providerErrors[0].provider
        + ' → ' + result.provider + ' (' + providerErrors[0].code + ')', { type: 'alert' });
    }
  } catch (err) {
    const code = err instanceof llm.ProviderError ? err.code : 'internal_error';
    /* Hiç içerik gitmediyse günlük hak iade edilir. */
    if (!started) {
      try { await store.refundQuota(quotaKey); } catch (e) { /* iade engel değil */ }
    }
    if (code !== 'client_aborted') {
      sse(res, 'error', { code: code === 'all_providers_failed' ? 'ai_unavailable' : 'internal_error' });
      console.error(llm.gizle(JSON.stringify({ ev: 'ai_assist_fail', code: code, last: err.last || null, providerErrors: providerErrors })));
      if (await tg.tekSefer('ai:down:' + code, 3600)) {
        await tg.sendTelegram('🚨 AI asistan yanıt veremedi: ' + code
          + (providerErrors.length ? ' [' + providerErrors.map(function (e) { return e.provider + ':' + e.code; }).join(', ') + ']' : ''),
        { type: 'alert' });
      }
    }
  }
  res.end();
}

module.exports = tg.ucuSar(handler, '/api/assistant-ai');
module.exports.CONSENT_VERSION = CONSENT_VERSION;
module.exports.LIMITS = { MAX_MESSAGE, MAX_HISTORY, RATE_MAX, DAILY_MAX };
