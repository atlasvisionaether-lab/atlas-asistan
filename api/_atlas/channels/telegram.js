'use strict';

/**
 * Telegram adaptörü (Bot API). Kliniğin kendi botu: BotFather'dan alınan token.
 *
 * connect: getMe ile token doğrulanır → setWebhook (kliniğe özel adres +
 *   secret_token, yalnız "message" olayları, bekleyen eski olaylar atılır).
 * verifyWebhook: X-Telegram-Bot-Api-Secret-Token = bağlantının webhook_secret'ı
 *   (Telegram her isteğe ekler; sabit zamanlı karşılaştırma).
 * Gelen: özel (private) sohbetlerdeki metin mesajları. Grup/kanal mesajı,
 *   bot mesajı ve metinsiz mesaj yok sayılır.
 */

const store = require('./store.js');
const secrets = require('./secrets.js');
const { MAX_TEXT, chunk, ChannelError } = require('./adapter.js');

const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/;

function api(token, method, body) {
  return store.http('https://api.telegram.org/bot' + token + '/' + method, { method: 'POST', body: body || {} });
}

async function connect(clinicId, credentials) {
  const token = String((credentials && credentials.botToken) || '').trim();
  if (!TOKEN_RE.test(token)) {
    return { success: false, status: 'error', error: 'token_format', message: 'Bot token biçimi hatalı. BotFather\'ın verdiği "123456789:ABC…" biçimindeki değeri yapıştırın.' };
  }
  if (!secrets.isConfigured()) return { success: false, status: 'error', error: 'server_config', message: 'Sunucu yapılandırması eksik; Atlas ekibine haber verin.' };

  const me = await api(token, 'getMe');
  if (!me.ok || !me.data || !me.data.ok || !me.data.result || !me.data.result.is_bot) {
    return { success: false, status: 'error', error: 'token_invalid', message: 'Telegram bu token\'ı tanımadı. BotFather\'dan aldığınız token\'ı kontrol edin.' };
  }
  const bot = me.data.result;
  const row = await store.beginConnect(clinicId, 'telegram');
  const hook = await api(token, 'setWebhook', {
    url: store.webhookUrl(row.id),
    secret_token: row.webhook_secret,
    allowed_updates: ['message'],
    drop_pending_updates: true
  });
  if (!hook.ok || !hook.data || !hook.data.ok) {
    await store.update(row.id, { status: 'error', last_error: 'set_webhook_failed' });
    return { success: false, status: 'error', error: 'set_webhook_failed', message: 'Telegram bağlantısı kurulamadı. Biraz sonra tekrar deneyin.' };
  }
  try {
    await store.update(row.id, {
      status: 'connected', external_id: String(bot.id), display_name: '@' + bot.username,
      creds: { botToken: token }, connected_at: new Date().toISOString(), last_error: null
    });
  } catch (e) {
    /* Aynı bot başka bir kliniğe bağlıysa benzersiz indeks reddeder. */
    await api(token, 'deleteWebhook', {});
    await store.update(row.id, { status: 'error', last_error: 'already_connected_elsewhere' });
    return { success: false, status: 'error', error: 'already_connected_elsewhere', message: 'Bu bot başka bir hesaba bağlı.' };
  }
  return { success: true, status: 'connected', message: '@' + bot.username + ' bağlandı. Bota Telegram\'dan bir mesaj yazarak deneyin.' };
}

async function disconnect(clinicId) {
  const conn = await store.byOrg(clinicId, 'telegram');
  if (!conn) return;
  if (conn.creds && conn.creds.botToken) await api(conn.creds.botToken, 'deleteWebhook', {});
  await store.disconnect(conn.id);
}

async function sendMessage(clinicId, to, text) {
  const conn = await store.byOrg(clinicId, 'telegram');
  if (!conn || conn.status !== 'connected' || !conn.creds) throw new ChannelError('not_connected');
  let lastId;
  for (const part of chunk(text, MAX_TEXT.telegram)) {
    const r = await api(conn.creds.botToken, 'sendMessage', { chat_id: to, text: part });
    if (!r.ok || !r.data || !r.data.ok) {
      throw new ChannelError('telegram_' + (r.data && r.data.error_code ? r.data.error_code : r.status || 'network'));
    }
    lastId = String(r.data.result.message_id);
  }
  return { id: lastId };
}

async function verifyWebhook(req) {
  if (req.method !== 'POST' || !req.connection || req.connection.channel !== 'telegram') return false;
  const h = req.headers || {};
  return secrets.safeEqual(h['x-telegram-bot-api-secret-token'], req.connection.webhook_secret);
}

function parseAll(payload, connection) {
  const m = payload && payload.message;
  if (!m || !m.chat || m.chat.type !== 'private' || typeof m.text !== 'string' || !m.text.trim()) return [];
  if (m.from && m.from.is_bot) return [];
  const f = m.from || {};
  const name = [f.first_name, f.last_name].filter(Boolean).join(' ') || (f.username ? '@' + f.username : null);
  return [{
    clinicId: connection ? connection.organization_id : '',
    channel: 'telegram',
    from: String(m.chat.id),
    text: m.text.trim(),
    timestamp: (m.date || 0) * 1000,
    raw: payload,
    /* message_id yalnız sohbet içinde benzersiz: sohbet kimliğiyle birleştirilir. */
    externalId: m.chat.id + ':' + m.message_id,
    name: name
  }];
}

function parseIncoming(payload, connection) {
  return parseAll(payload, connection)[0] || null;
}

module.exports = { type: 'telegram', connect, disconnect, sendMessage, verifyWebhook, parseIncoming, parseAll, TOKEN_RE };
