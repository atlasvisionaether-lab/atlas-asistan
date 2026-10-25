'use strict';

/**
 * Klinik sahibi rehberi — DeepSeek ile ELI10 anlatım (panel #rehber).
 *
 *   GET  /api/atlas-guide                → { enabled, topics }  (konu/adım listesi; LLM yok)
 *   POST /api/atlas-guide  (JSON)        → 200 { text, topic, step, total, title }
 *        { topic, step, question?, history? }    | 400 | 401 | 429 | 503 | 502
 *
 * Çağıran müşteri paneli (başka origin, CORS — bkz. _atlas/panel.js); oturum
 * ZORUNLU (Bearer Supabase jetonu). Her rol kullanabilir.
 *
 * DOĞRULUK: model yalnızca adımın `facts` listesini anlatır (_atlas/guide-content.js).
 * Sistem metni uydurmayı, şifre/kod istemeyi ve listede olmayan özelliği
 * anlatmayı yasaklar. LLM yoksa ya da düşerse panel aynı facts'i düz liste
 * olarak gösterir (503/502 cevabında da facts döner).
 *
 * MALİYET: kullanıcı başına 24 saatte GUIDE_DAILY_LIMIT istek
 * (atlas_guide_usage, migration 0018). Tablo yoksa sınır uygulanmaz (uyarı
 * loglanır) — rehber çalışmaya devam eder.
 *
 * Soru metni ve sohbet LOGLANMAZ.
 */

const llm = require('../cyberlionai/api/_lib/llm.js');
const db = require('../cyberlionai/api/_lib/db.js');
const tg = require('../cyberlionai/api/_lib/telegram.js');
const panel = require('./_atlas/panel.js');
const guide = require('./_atlas/guide-content.js');

const DAILY_LIMIT_DEFAULT = 60;
const QUESTION_MAX = 500;
const HISTORY_MAX = 6;
const HISTORY_ITEM_MAX = 1500;

function jsonBody(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  const raw = Buffer.isBuffer(b) ? b.toString('utf8') : (typeof b === 'string' ? b : '');
  try { return raw ? JSON.parse(raw) || {} : {}; } catch (e) { return {}; }
}

function dailyLimit() {
  const n = parseInt(process.env.GUIDE_DAILY_LIMIT, 10);
  return n > 0 ? n : DAILY_LIMIT_DEFAULT;
}

/** Son 24 saatteki istek sayısı sınırı aştıysa true. Tablo yoksa false (fail-open, uyarıyla). */
async function overLimit(userId) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  try {
    const rows = await db.request('atlas_guide_usage?user_id=eq.' + userId
      + '&created_at=gte.' + encodeURIComponent(since) + '&select=id&limit=' + (dailyLimit() + 1));
    if (Array.isArray(rows) && rows.length >= dailyLimit()) return true;
    await db.request('atlas_guide_usage', { method: 'POST', body: { user_id: userId } });
    return false;
  } catch (e) {
    console.warn('atlas-guide: usage_unavailable (' + (e && e.message) + ')');
    return false;
  }
}

/** İstemciden gelen geçmiş: yalnız user/assistant, son HISTORY_MAX mesaj, kısaltılmış. */
function cleanHistory(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(-HISTORY_MAX).filter(function (m) {
    return m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string';
  }).map(function (m) {
    return { role: m.role, content: m.content.slice(0, HISTORY_ITEM_MAX) };
  });
}

function systemPrompt(topic, index, clinicName) {
  const step = topic.steps[index];
  const plan = topic.steps.map(function (s, i) { return (i + 1) + '. ' + s.title; }).join('\n');
  return [
    'Sen Atlas Asistan panelinde klinik sahiplerine yardım eden sabırlı bir öğretmensin. ' +
      'Her şeyi 10 yaşındaki bir çocuğa anlatır gibi (ELI10) açıklarsın: kısa cümleler, günlük kelimeler, ' +
      'teknik terim kullanırsan hemen ne demek olduğunu söylersin, gerekirse tek bir basit benzetme yaparsın.',
    'KURALLAR:',
    '- Türkçe yaz. Sen değil "siz" diye hitap et. En fazla 120 kelime.',
    '- Yapılacak işleri 1., 2., 3. diye numaralı kısa satırlarla yaz. Markdown, başlık, kalın yazı KULLANMA.',
    '- YALNIZCA aşağıdaki "BİLGİLER" listesindeki bilgileri kullan. Listede olmayan bir düğme, ekran, özellik, süre ya da fiyat UYDURMA.',
    '- Sorunun cevabı bilgilerde yoksa bunu açıkça söyle ve Atlas ekibine yazmayı öner: merhaba@atlasasistan.com',
    '- Bir özellik bilgilerde "yok" ya da "kullanılmıyor" diye geçiyorsa, var gibi anlatma.',
    '- Asla şifre, doğrulama kodu, kart bilgisi ya da TC Kimlik No isteme.',
    '- Sonda tek kısa cümleyle bir sonraki adıma geçmeye ya da soru sormaya davet et.',
    '',
    'Klinik: ' + (clinicName || 'bilinmiyor'),
    'Konu: ' + topic.title,
    'Konunun adımları:\n' + plan,
    'Şu anki adım: ' + (index + 1) + '/' + topic.steps.length + ' — ' + step.title,
    'BİLGİLER:\n' + step.facts.map(function (f) { return '- ' + f; }).join('\n')
  ].join('\n');
}

/** Model yine de markdown yazarsa düz metne indirger. */
function plain(text) {
  return String(text || '').replace(/\*\*|__|`/g, '').replace(/^#+\s*/gm, '').trim();
}

async function clinicName(orgId) {
  try {
    const rows = await db.request('organizations?id=eq.' + orgId + '&select=name&limit=1');
    return Array.isArray(rows) && rows[0] ? rows[0].name : null;
  } catch (e) {
    return null;
  }
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  panel.cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    return res.status(200).json({ enabled: llm.isConfigured(), topics: guide.outline() });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  const body = jsonBody(req);
  const topic = guide.topicOf(String(body.topic || ''));
  const index = Number.isInteger(body.step) ? body.step : -1;
  if (!topic || index < 0 || index >= topic.steps.length) return res.status(400).json({ error: { code: 'step' } });
  const step = topic.steps[index];
  const meta = { topic: topic.id, step: index, total: topic.steps.length, title: step.title, facts: step.facts };

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (question.length > QUESTION_MAX) return res.status(400).json({ error: { code: 'question_too_long' } });

  const member = await panel.memberFromRequest(req);
  if (!member) return res.status(401).json({ error: { code: 'auth' } });
  if (!llm.isConfigured()) return res.status(503).json(Object.assign({ error: { code: 'unavailable' } }, meta));
  if (await overLimit(member.userId)) return res.status(429).json(Object.assign({ error: { code: 'limit' } }, meta));

  const messages = cleanHistory(body.history).concat([{
    role: 'user',
    content: question || ('"' + step.title + '" adımını bana anlat.')
  }]);

  let text = '';
  try {
    const result = await llm.streamChat({
      tier: 'flash',
      system: systemPrompt(topic, index, await clinicName(member.orgId)),
      messages: messages,
      onDelta: function (d) { text += d; },
      onProviderError: function (e) { console.warn('atlas-guide: provider ' + e.provider + ' ' + e.code); }
    });
    if (result.finishReason === 'interrupted' && !text) throw new Error('interrupted');
  } catch (e) {
    console.warn('atlas-guide: llm_failed (' + ((e && e.code) || (e && e.message) || 'unknown') + ')');
    return res.status(502).json(Object.assign({ error: { code: 'llm' } }, meta));
  }

  return res.status(200).json(Object.assign({ text: plain(text) }, meta));
}

module.exports = tg.ucuSar(handler, '/api/atlas-guide');
module.exports.systemPrompt = systemPrompt;
module.exports.cleanHistory = cleanHistory;
