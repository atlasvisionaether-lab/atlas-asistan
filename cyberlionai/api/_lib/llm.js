'use strict';

/**
 * Hibrit dil modeli katmanı: DeepSeek (birincil) + Claude Haiku (yedek).
 *
 *   streamChat({ tier, system, messages, signal, onStart, onThinking, onDelta })
 *     → { provider, model, finishReason, usage }
 *
 * SAĞLAYICILAR
 *   deepseek   OpenAI uyumlu /chat/completions, SSE. Katman → model:
 *                flash → DEEPSEEK_MODEL_FLASH (varsayılan deepseek-flash)
 *                pro   → DEEPSEEK_MODEL_PRO   (varsayılan deepseek-v4-pro)
 *   anthropic  Messages API /v1/messages, SSE. Tek model (ANTHROPIC_MODEL,
 *              varsayılan claude-haiku-4-5); iki katman için de yedek.
 *
 * Paket yok: proje bilinçli olarak bağımlılıksız (bkz. docs/auth.md), iki uç
 * da belgelenmiş HTTP + SSE biçimiyle `fetch` üzerinden çağrılıyor.
 *
 * YEDEĞE GEÇİŞ (FALLBACK) — NE ZAMAN, NE ZAMAN DEĞİL
 *
 * Geçiş yalnızca kullanıcıya TEK KELİME gitmeden önce olur: bağlantı hatası,
 * 5xx/429/408, ya da ilk içerik FIRST_TOKEN_MS içinde gelmezse. İlk kelime
 * ekrana düştükten sonra sağlayıcı düşerse yanıt yarıda kalır ve
 * `finishReason: 'interrupted'` döner; ikinci bir modelle baştan yazmak
 * ekranda iki farklı yanıtın birbirine eklenmesi demek olurdu.
 *
 * 4xx (401/403/400): yapılandırma ya da istek hatası. Yine de yedeğe geçilir
 * (kullanıcı cevap alsın), ama hata `onProviderError` ile bildirilir; anahtar
 * süresi dolduysa sessizce Haiku faturası birikmesin.
 *
 * ANAHTARLAR
 *
 * Anahtarlar yalnızca istek başlığında kullanılır; hiçbir loga, hata
 * mesajına ya da istemciye dönen olaya girmez (`gizle`).
 */

const DEFAULTS = {
  deepseekBase: 'https://api.deepseek.com',
  deepseekFlash: 'deepseek-flash',
  deepseekPro: 'deepseek-v4-pro',
  anthropicBase: 'https://api.anthropic.com',
  anthropicModel: 'claude-haiku-4-5',
  anthropicVersion: '2023-06-01'
};

/* İlk içerik bu sürede gelmezse yedeğe geçilir. Pro modeli önce düşünme
   (reasoning) akıtabilir; düşünme parçası da "canlı" sayılır. */
const FIRST_TOKEN_MS = 15000;
/* Bir parça ile sonraki arasında en uzun sessizlik. */
const IDLE_MS = 30000;

/* DeepSeek'te max_tokens DÜŞÜNME token'larını da kapsar (belgelenmiş). İlk
   canlı denemede pro 3000 token'ın tamamını düşünmeye harcadı ve cevap boş
   döndü. Flash'ta düşünme kapalı; pro'da 'low' + geniş tavan: hem cevaba yer
   kalır hem fonksiyonun 60 sn sınırı içinde biter. */
const MAX_TOKENS = { flash: 1500, pro: 8000 };
const REASONING = { flash: 'none', pro: 'low' };
const REASONING_VALUES = ['none', 'low', 'high', 'max'];

function reasoningFor(tier) {
  const v = String(process.env[tier === 'pro' ? 'DEEPSEEK_REASONING_PRO' : 'DEEPSEEK_REASONING_FLASH'] || '').toLowerCase();
  return REASONING_VALUES.indexOf(v) !== -1 ? v : REASONING[tier];
}
const TEMPERATURE = { flash: 0.3, pro: 0.2 };

function keyOk(k) { return typeof k === 'string' && k.length >= 20; }

function config() {
  const env = process.env;
  return {
    deepseek: keyOk(env.DEEPSEEK_API_KEY) ? {
      key: env.DEEPSEEK_API_KEY,
      base: String(env.DEEPSEEK_BASE_URL || DEFAULTS.deepseekBase).replace(/\/+$/, ''),
      models: {
        flash: env.DEEPSEEK_MODEL_FLASH || DEFAULTS.deepseekFlash,
        pro: env.DEEPSEEK_MODEL_PRO || DEFAULTS.deepseekPro
      }
    } : null,
    anthropic: keyOk(env.ANTHROPIC_API_KEY) ? {
      key: env.ANTHROPIC_API_KEY,
      base: String(env.ANTHROPIC_BASE_URL || DEFAULTS.anthropicBase).replace(/\/+$/, ''),
      model: env.ANTHROPIC_MODEL || DEFAULTS.anthropicModel
    } : null
  };
}

/** En az bir sağlayıcının anahtarı var mı. */
function isConfigured() {
  const c = config();
  return Boolean(c.deepseek || c.anthropic);
}

/** Metinden anahtarları siler (hata gövdeleri isteği yankılayabilir). */
function gizle(metin) {
  let s = metin === null || metin === undefined ? '' : String(metin);
  [process.env.DEEPSEEK_API_KEY, process.env.ANTHROPIC_API_KEY].forEach(function (k) {
    if (k) s = s.split(String(k)).join('[key]');
  });
  return s;
}

class ProviderError extends Error {
  constructor(code, status, retryable) {
    super(code);
    this.code = code;
    this.status = status || 0;
    this.retryable = retryable !== false;
  }
}

/* ---------------------------------------------------------------------------
   SSE ayrıştırıcı: fetch gövdesi (web ReadableStream) → { event, data } olayları.
   Satır sonu \n, \r\n ya da \r olabilir; bir olay boş satırla biter.
   ------------------------------------------------------------------------- */
async function* sseEvents(body, idleMs) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      let timer;
      const chunk = await Promise.race([
        reader.read(),
        new Promise(function (_, reject) {
          timer = setTimeout(function () { reject(new ProviderError('idle_timeout', 0, true)); }, idleMs);
        })
      ]).finally(function () { clearTimeout(timer); });
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = buffer.replace(/\r\n?/g, '\n');
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let event = 'message';
        const data = [];
        raw.split('\n').forEach(function (line) {
          if (line.indexOf('event:') === 0) event = line.slice(6).trim();
          else if (line.indexOf('data:') === 0) data.push(line.slice(5).replace(/^ /, ''));
        });
        if (data.length) yield { event: event, data: data.join('\n') };
      }
    }
  } finally {
    try { reader.releaseLock(); } catch (e) { /* zaten bırakıldı */ }
  }
}

function parseJson(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

/* ---------------------------------------------------------------------------
   Sağlayıcı istekleri. Her biri, parçaları { type: 'text'|'thinking'|'done', ... }
   olarak veren bir async üreteç döndürür.
   ------------------------------------------------------------------------- */

function statusError(status) {
  const retryable = status === 408 || status === 409 || status === 429 || status >= 500;
  return new ProviderError('http_' + status, status, retryable);
}

async function* deepseekStream(cfg, tier, system, messages, signal) {
  const res = await fetch(cfg.base + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Authorization': 'Bearer ' + cfg.key
    },
    body: JSON.stringify({
      model: cfg.models[tier],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: MAX_TOKENS[tier],
      temperature: TEMPERATURE[tier],
      thinking: { type: reasoningFor(tier) === 'none' ? 'disabled' : 'enabled' },
      reasoning_effort: reasoningFor(tier),
      messages: [{ role: 'system', content: system }].concat(messages.map(function (m) {
        return { role: m.role, content: m.content };
      }))
    }),
    signal: signal
  });
  if (!res.ok || !res.body) throw statusError(res.status);

  let finish = null;
  let usage = null;
  let sawText = false;
  for await (const ev of sseEvents(res.body, IDLE_MS)) {
    if (ev.data === '[DONE]') break;
    const j = parseJson(ev.data);
    if (!j) continue;
    if (j.error) throw new ProviderError('stream_error', 0, true);
    if (j.usage) usage = { input: j.usage.prompt_tokens || 0, output: j.usage.completion_tokens || 0 };
    const choice = j.choices && j.choices[0];
    if (!choice) continue;
    const d = choice.delta || {};
    /* Düşünme içeriği kullanıcıya gösterilmez, yalnızca "canlı" sinyali. */
    if (typeof d.reasoning_content === 'string' && d.reasoning_content) yield { type: 'thinking' };
    if (typeof d.content === 'string' && d.content) { sawText = true; yield { type: 'text', text: d.content }; }
    if (choice.finish_reason) finish = choice.finish_reason;
  }
  /* finish_reason hiç gelmeden kapanan akış yarımdır (inceleme bulgusu):
     "tamamlandı" sayılırsa yarım cevap hafızaya yazılır ve teklif eklenirdi. */
  yield { type: 'done', finishReason: finish === null ? 'interrupted' : finish === 'length' ? 'max_tokens' : 'stop', usage: usage, sawText: sawText };
}

async function* anthropicStream(cfg, tier, system, messages, signal) {
  const res = await fetch(cfg.base + '/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'x-api-key': cfg.key,
      'anthropic-version': DEFAULTS.anthropicVersion
    },
    body: JSON.stringify({
      model: cfg.model,
      stream: true,
      max_tokens: MAX_TOKENS[tier],
      temperature: TEMPERATURE[tier],
      system: system,
      messages: messages
    }),
    signal: signal
  });
  if (!res.ok || !res.body) throw statusError(res.status);

  let finish = null;
  let stopped = false;
  const usage = { input: 0, output: 0 };
  for await (const ev of sseEvents(res.body, IDLE_MS)) {
    const j = parseJson(ev.data);
    if (!j) continue;
    if (j.type === 'error') {
      const t = j.error && j.error.type;
      throw new ProviderError(t === 'overloaded_error' ? 'overloaded' : 'stream_error', 0, true);
    }
    if (j.type === 'message_start' && j.message && j.message.usage) {
      usage.input = j.message.usage.input_tokens || 0;
    } else if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta' && j.delta.text) {
      yield { type: 'text', text: j.delta.text };
    } else if (j.type === 'message_delta') {
      if (j.delta && j.delta.stop_reason) finish = j.delta.stop_reason;
      if (j.usage && j.usage.output_tokens) usage.output = j.usage.output_tokens;
    } else if (j.type === 'message_stop') {
      stopped = true;
      break;
    }
  }
  yield { type: 'done', finishReason: !stopped ? 'interrupted' : finish === 'max_tokens' ? 'max_tokens' : 'stop', usage: usage };
}

/* ---------------------------------------------------------------------------
   Mesaj biçimi: [{ role: 'user'|'assistant', content: string }]. Anthropic
   ilk mesajın kullanıcı olmasını ve rollerin sırayla gelmesini ister; ikisi
   için de aynı temizlenmiş dizi kullanılır.
   ------------------------------------------------------------------------- */
function normalizeMessages(list) {
  const out = [];
  (list || []).forEach(function (m) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return;
    const content = typeof m.content === 'string' ? m.content.trim() : '';
    if (!content) return;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += '\n\n' + content;
    else out.push({ role: m.role, content: content });
  });
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

/** Bu katman için denenecek sağlayıcılar, sırayla. */
function plan(tier) {
  const c = config();
  const steps = [];
  if (c.deepseek) steps.push({ provider: 'deepseek', model: c.deepseek.models[tier], run: deepseekStream.bind(null, c.deepseek) });
  if (c.anthropic) steps.push({ provider: 'anthropic', model: c.anthropic.model, run: anthropicStream.bind(null, c.anthropic) });
  return steps;
}

/**
 * Akışlı sohbet. Kullanıcıya ilk parça gitmeden önceki her hata bir sonraki
 * sağlayıcıyı dener.
 *
 * Geri çağrılar:
 *   onStart({ provider, model, fallback })   ilk içerikten hemen önce, bir kez
 *   onThinking()                             pro modeli düşünürken (gösterge)
 *   onDelta(text)                            her metin parçası
 *   onProviderError({ provider, code })      denenen sağlayıcı düştü (loglama)
 */
async function streamChat(opts) {
  const tier = opts.tier === 'pro' ? 'pro' : 'flash';
  const messages = normalizeMessages(opts.messages);
  if (!messages.length) throw new ProviderError('empty_messages', 400, false);

  const steps = plan(tier);
  if (!steps.length) throw new ProviderError('unconfigured', 503, false);

  let lastErr = null;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    /* Her denemenin kendi iptal sinyali: ilk içerik zaman aşımında bu
       sağlayıcı kesilir, istemcinin sinyali ise hepsini keser. */
    const ctrl = new AbortController();
    const onOuterAbort = function () { ctrl.abort(); };
    if (opts.signal) {
      if (opts.signal.aborted) throw new ProviderError('client_aborted', 0, false);
      opts.signal.addEventListener('abort', onOuterAbort, { once: true });
    }
    const firstTimer = setTimeout(function () { ctrl.abort(); }, opts.firstTokenMs || FIRST_TOKEN_MS);

    let started = false;
    try {
      const iterator = step.run(tier, opts.system, messages, ctrl.signal);
      for await (const part of iterator) {
        if (part.type === 'thinking') {
          clearTimeout(firstTimer);
          if (opts.onThinking) opts.onThinking();
          continue;
        }
        if (part.type === 'text') {
          if (!started) {
            started = true;
            clearTimeout(firstTimer);
            if (opts.onStart) opts.onStart({ provider: step.provider, model: step.model, fallback: i > 0 });
          }
          opts.onDelta(part.text);
          continue;
        }
        if (part.type === 'done') {
          /* Tavan düşünmeye yetti, cevaba kalmadı: ayrı kodla loglansın. */
          if (!started) throw new ProviderError(part.finishReason === 'max_tokens' ? 'reasoning_budget_exhausted' : 'empty_response', 0, true);
          return { provider: step.provider, model: step.model, fallback: i > 0, finishReason: part.finishReason, usage: part.usage };
        }
      }
      if (!started) throw new ProviderError('empty_response', 0, true);
      return { provider: step.provider, model: step.model, fallback: i > 0, finishReason: 'stop', usage: null };
    } catch (err) {
      if (opts.signal && opts.signal.aborted) throw new ProviderError('client_aborted', 0, false);
      const code = err instanceof ProviderError ? err.code
        : (err && err.name === 'AbortError' ? 'first_token_timeout' : 'network_error');
      if (opts.onProviderError) {
        try { opts.onProviderError({ provider: step.provider, code: code }); } catch (e) { /* loglama engel değil */ }
      }
      /* İlk kelime gittiyse başka modele geçilmez: yanıt yarıda kalır. */
      if (started) {
        return { provider: step.provider, model: step.model, fallback: i > 0, finishReason: 'interrupted', usage: null };
      }
      lastErr = err instanceof ProviderError ? err : new ProviderError(code, 0, true);
    } finally {
      clearTimeout(firstTimer);
      if (opts.signal) opts.signal.removeEventListener('abort', onOuterAbort);
      /* Yarıda kalan ya da biten akışın bağlantısı açık kalmasın. */
      ctrl.abort();
    }
  }
  const fail = new ProviderError('all_providers_failed', 502, true);
  fail.last = lastErr ? lastErr.code : null;
  throw fail;
}

module.exports = {
  streamChat, isConfigured, config, gizle, normalizeMessages, sseEvents,
  ProviderError, FIRST_TOKEN_MS, MAX_TOKENS, REASONING, DEFAULTS
};
