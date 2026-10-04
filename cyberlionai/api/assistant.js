'use strict';

/**
 * Cyber Lion Asistan.
 *
 *   GET  /api/assistant?lang=tr       →  { suggestions: [{ id, q }] }   (karşılama düğmeleri)
 *   POST /api/assistant  { message?, intent?, lang, history[] }
 *        →  { type, intent, score, answer, suggestions, handoff }
 *
 *   type: 'answer'   bilgi tabanından kanonik cevap
 *         'smalltalk' selamlaşma / teşekkür: karşılama metni, bildirim yok
 *         'urgent'   olası aktif güvenlik olayı: uzmana yönlendir
 *         'fallback' net cevap yok: uzmana yönlendir
 *
 * TUTARLILIK
 *
 * Cevaplar `data/knowledge.json`'dan geliyor ve her niyetin TEK kanonik cevabı
 * var. Puanlama saf ve deterministik: rastgelelik, zaman ya da durum yok.
 * Aynı soru (aynı geçmişle) her zaman aynı cevabı alır.
 *
 * PUANLAMA
 *
 * Mesaj sadeleştirilir (küçük harf, ı→i, ş→s …). Her niyetin anahtar
 * kelimeleri "strong" (0.7) ve "weak" (0.35) ağırlıklı. Eşleşen kelimelerin
 * ağırlıkları olasılık gibi birleşir: puan = 1 - Π(1 - w). Tek bir güçlü
 * kelime (csp, fiyat, insan) eşiği (0.6) geçer; tek bir zayıf kelime (plan,
 * adres) geçmez, ikisi birlikte geçer. Türkçe ekler için tek kelimelik anahtar
 * kelime bir sözcüğün BAŞINDA aranıyor ("uzman" → "uzmanla").
 *
 * BAĞLAM
 *
 * Eşik altı bir mesaj, önceki kullanıcı mesajıyla birlikte yeniden puanlanıyor
 * ("Pro ne kadar?" → "peki enterprise?"). Geçmiş istemciden geliyor ve
 * güvenilmiyor: yalnızca metin olarak kullanılıyor, uzunluğu ve sayısı
 * sınırlı, cevabı yalnızca puanlamayı etkiliyor.
 *
 * TELEGRAM
 *
 * Yanıtlanamayan soru ve olası aktif olay bildiriliyor. Soru metni
 * `serbestMetin`'den geçiyor (e-posta maskeli, uzun sayılar gizli). Aynı soru
 * için günde bir bildirim: biri aynı anlamsız metni tekrar tekrar yazarak
 * kanalı dolduramaz.
 */

const crypto = require('node:crypto');
const KB = require('../data/knowledge.json');
const store = require('./_lib/store.js');
const { clientIp, ipKey } = require('./_lib/session.js');
const tg = require('./_lib/telegram.js');

const LANGS = ['tr', 'en'];
const MAX_MESSAGE = 500;
const MAX_HISTORY = 6;
const RATE_WINDOW_SECONDS = 60;
const RATE_MAX = 30;

/** Küçük harf + Türkçe karakter sadeleştirme. */
function normalize(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/İ/g, 'i').replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9@.\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Bir anahtar kelime mesajda var mı.
 * Çok kelimeli ifade: sadeleşmiş metnin içinde aranır.
 * Tek kelime: bir sözcüğün başında aranır (Türkçe ekler). 3 harf ve daha kısa
 * kelime yalnızca birebir eşleşir: "pro" "protokol"ü, "tls" başka bir şeyi
 * yakalamasın.
 */
function hasKeyword(normalized, words, keyword) {
  if (keyword.indexOf(' ') !== -1) return (' ' + normalized + ' ').indexOf(' ' + keyword) !== -1;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (keyword.length <= 3 ? w === keyword : w.indexOf(keyword) === 0) return true;
  }
  return false;
}

/** Bir niyetin puanı (0–1). */
function scoreIntent(normalized, words, intent) {
  let miss = 1;
  ['strong', 'weak'].forEach(function (kind) {
    const weight = KB.weights[kind];
    (intent.keywords[kind] || []).forEach(function (k) {
      if (hasKeyword(normalized, words, k)) miss *= (1 - weight);
    });
  });
  return 1 - miss;
}

/**
 * En iyi niyet. Eşitlikte knowledge.json'daki SIRA kazanır, böylece sonuç
 * deterministik kalır.
 */
function classify(message) {
  const normalized = normalize(message);
  const words = normalized.split(' ').filter(Boolean);
  let best = null, bestScore = 0;
  Object.keys(KB.intents).forEach(function (id) {
    const s = scoreIntent(normalized, words, KB.intents[id]);
    if (s > bestScore) { best = id; bestScore = s; }
  });
  return { intent: best, score: Math.round(bestScore * 100) / 100 };
}

function isUrgent(message) {
  const normalized = normalize(message);
  const words = normalized.split(' ').filter(Boolean);
  return (KB.urgent.keywords || []).some(function (k) { return hasKeyword(normalized, words, k); });
}

/** Mesaj YALNIZCA selam/teşekkür mü (en fazla 4 kelime ve küçük sohbet kelimesi içeriyor). */
function isSmalltalk(message) {
  const normalized = normalize(message);
  const words = normalized.split(' ').filter(Boolean);
  if (!words.length || words.length > 4) return false;
  return (KB.smalltalk.keywords || []).some(function (k) { return hasKeyword(normalized, words, k); });
}

function answerOf(id, lang) {
  const entry = KB.intents[id] && KB.intents[id][lang];
  if (!entry) return null;
  const out = { q: entry.q, a: entry.a };
  if (entry.code) out.code = entry.code;
  if (entry.a2) out.a2 = entry.a2;
  return out;
}

function suggestionsOf(ids, lang) {
  return (ids || []).filter(function (id) { return KB.intents[id]; })
    .map(function (id) { return { id: id, q: KB.intents[id][lang].q }; });
}

/** Geçmişten son kullanıcı mesajı (metin, kırpılmış) ya da null. */
function lastUserMessage(history) {
  if (!Array.isArray(history)) return null;
  const list = history.slice(-MAX_HISTORY);
  for (let i = list.length - 1; i >= 0; i--) {
    const h = list[i];
    if (h && h.role === 'user' && typeof h.text === 'string' && h.text.trim()) {
      return h.text.slice(0, MAX_MESSAGE);
    }
  }
  return null;
}

/**
 * Saf karar fonksiyonu: ağ yok, yan etki yok. Uç ve sınama bunu kullanıyor.
 */
function decide(input) {
  const lang = LANGS.indexOf(input.lang) !== -1 ? input.lang : 'tr';

  /* Düğmeden gelen niyet: doğrudan kanonik cevap. */
  if (input.intent && KB.intents[input.intent]) {
    const def = KB.intents[input.intent];
    return {
      type: 'answer', intent: input.intent, score: 1,
      answer: answerOf(input.intent, lang),
      suggestions: suggestionsOf(def.related, lang),
      handoff: def.handoff === true
    };
  }

  const message = input.message;

  if (isUrgent(message)) {
    return {
      type: 'urgent', intent: null, score: 1, answer: null,
      suggestions: [], handoff: true
    };
  }

  let c = classify(message);

  /* Selam/teşekkür: bilgi tabanı sorusu değil, uzmana da gitmemeli. Ama
     "merhaba, fiyatlar?" gibi bir soru taşıyorsa soru kazanır. */
  if (c.score < KB.threshold && isSmalltalk(message)) {
    return {
      type: 'smalltalk', intent: null, score: c.score, answer: null,
      suggestions: suggestionsOf(KB.greeting, lang), handoff: false
    };
  }

  let contextual = false;
  if (c.score < KB.threshold) {
    const prev = lastUserMessage(input.history);
    if (prev) {
      const withContext = classify(prev + ' ' + message);
      if (withContext.score >= KB.threshold) { c = withContext; contextual = true; }
    }
  }

  if (c.intent && c.score >= KB.threshold) {
    const def = KB.intents[c.intent];
    const out = {
      type: 'answer', intent: c.intent, score: c.score,
      answer: answerOf(c.intent, lang),
      suggestions: suggestionsOf(def.related, lang),
      handoff: def.handoff === true
    };
    if (contextual) out.contextual = true;
    return out;
  }

  return {
    type: 'fallback', intent: null, score: c.score, answer: null,
    suggestions: suggestionsOf(KB.fallbackSuggestions, lang),
    handoff: true
  };
}

function bodyOf(req) {
  const b = req && req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string' && b) { try { return JSON.parse(b); } catch (e) { return null; } }
  return null;
}

/** Aynı sorunun bildirim kilidi: sadeleşmiş metnin özeti, metnin kendisi değil. */
function questionKey(message) {
  return crypto.createHash('sha256').update(normalize(message)).digest('hex').slice(0, 24);
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const lang = LANGS.indexOf(req.query && req.query.lang) !== -1 ? req.query.lang : 'tr';
    return res.status(200).json({ suggestions: suggestionsOf(KB.greeting, lang) });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  const body = bodyOf(req);
  const intent = body && typeof body.intent === 'string' ? body.intent : null;
  const message = body && typeof body.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE) : '';
  const lang = body && typeof body.lang === 'string' ? body.lang.toLowerCase().slice(0, 2) : 'tr';
  const history = body && Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY) : [];

  if (!message && !(intent && KB.intents[intent])) {
    return res.status(400).json({ error: { code: 'empty' } });
  }

  /* Hız sınırı. Depo yoksa ya da düşerse istek reddedilmiyor: uç yalnızca
     sabit bir dosyadan okuyor, dış maliyetli bir kaynak tüketmiyor. */
  if (store.isConfigured()) {
    try {
      const rate = await store.hitRateLimit('cl:rl:assist:' + ipKey(clientIp(req)), RATE_WINDOW_SECONDS);
      if (rate.count > RATE_MAX) {
        const retryAfter = rate.ttl > 0 ? rate.ttl : RATE_WINDOW_SECONDS;
        res.setHeader('Retry-After', String(retryAfter));
        return res.status(429).json({ error: { code: 'rate_limited', retryAfter: retryAfter } });
      }
    } catch (err) { /* sınır uygulanamadı, istek kabul */ }
  }

  const result = decide({ message: message, intent: intent, lang: lang, history: history });

  if (result.type === 'urgent' && await tg.tekSefer('assist:u:' + questionKey(message), 3600)) {
    await tg.sendTelegram(tg.mesaj.asistanAcil(message), { type: 'alert' });
  } else if (result.type === 'fallback' && await tg.tekSefer('assist:f:' + questionKey(message), 86400)) {
    await tg.sendTelegram(tg.mesaj.asistanCevapsiz(message, lang), { type: 'assist' });
  }

  return res.status(200).json(result);
}

module.exports = tg.ucuSar(handler, '/api/assistant');
module.exports.decide = decide;
module.exports.classify = classify;
module.exports.normalize = normalize;
