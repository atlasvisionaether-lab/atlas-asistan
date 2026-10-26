'use strict';
/**
 * Çok kanallı asistan: adaptörler + /api/atlas-channels, -webhook, -send.
 *
 *   node tools/atlas-channels-test.js
 *
 * Ağ yok: global fetch sahte — Supabase (PostgREST tabloları bellekte + Auth),
 * Telegram Bot API, Meta Graph API. Webhook ucu GERÇEK bir Node HTTP sunucusu
 * üzerinden çağrılır: ham gövde akıştan okunur, Meta imzası o baytlarla sınanır.
 */

const http = require('node:http');
const crypto = require('node:crypto');

const ORG_A = '00000000-0000-4000-a000-00000000000a';
const ORG_B = '00000000-0000-4000-a000-00000000000b';
const OWNER = 'Bearer ' + 'o'.repeat(40);
const RECEP = 'Bearer ' + 'r'.repeat(40);
const TG_TOKEN = '123456789:' + 'A'.repeat(35);
const APP_SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const META_TOKEN = 'EAAG' + 'x'.repeat(80);
const SEND_SECRET = 'f'.repeat(64);
const U_OWNER = '00000000-0000-4000-a000-0000000000a1';
const U_RECEP = '00000000-0000-4000-a000-0000000000a2';

Object.assign(process.env, {
  SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key-xxxxxxxxxxxxxxxx',
  CHANNEL_ENC_KEY: crypto.randomBytes(32).toString('hex'), SITE_URL: 'https://atlasasistan.com'
});
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.ATLAS_PANEL_URL;

/* ---------------- Sahte Supabase ---------------- */
const T = { channel_connections: [], customers: [], messages: [] };
let inboundCalls = [];
let seq = 0;
const uid = () => '00000000-0000-4000-b000-' + String(++seq).padStart(12, '0');

function filterRows(rows, q) {
  return rows.filter(function (r) {
    let ok = true;
    q.forEach(function (v, k) {
      if (['select', 'limit', 'order', 'on_conflict'].includes(k)) return;
      if (v.startsWith('eq.')) { if (String(r[k]) !== decodeURIComponent(v.slice(3))) ok = false; }
      else if (v === 'is.null') { if (r[k] !== null && r[k] !== undefined) ok = false; }
    });
    return ok;
  });
}
function json(status, body) {
  return Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}
function supabase(u, method, body, headers) {
  if (u.pathname === '/auth/v1/user') {
    const a = headers.Authorization;
    if (a === OWNER) return json(200, { id: U_OWNER, email: 'o@x.com' });
    if (a === RECEP) return json(200, { id: U_RECEP, email: 'r@x.com' });
    return json(401, {});
  }
  const path = u.pathname.replace('/rest/v1/', '');
  if (path === 'users') {
    const id = u.searchParams.get('id').slice(3);
    return json(200, [{ organization_id: ORG_A, role: id === U_OWNER ? 'owner' : 'receptionist' }]);
  }
  if (path === 'rpc/atlas_channel_inbound') { inboundCalls.push(body); return json(200, uid()); }
  if (path === 'rpc/atlas_check_send_secret') return json(200, body.p_secret === SEND_SECRET);
  const rows = T[path];
  if (!rows) throw new Error('bilinmeyen tablo ' + path);
  if (method === 'GET') {
    const lim = Number(u.searchParams.get('limit')) || 1000;
    return json(200, filterRows(rows, u.searchParams).slice(0, lim));
  }
  if (method === 'POST') {
    let row = rows.find(function (r) { return r.organization_id === body.organization_id && r.channel === body.channel; });
    if (row) Object.assign(row, body); else { row = Object.assign({ id: uid() }, body); rows.push(row); }
    return json(201, [row]);
  }
  if (method === 'PATCH') {
    const hit = filterRows(rows, u.searchParams);
    if (path === 'channel_connections' && body.external_id && ['pending', 'connected'].includes(body.status || hit[0].status)) {
      const clash = rows.find(function (r) { return r !== hit[0] && r.channel === hit[0].channel && r.external_id === body.external_id && ['pending', 'connected'].includes(r.status); });
      if (clash) return json(409, { code: '23505' });
    }
    hit.forEach(function (r) { Object.assign(r, body); });
    return json(200, hit);
  }
  throw new Error('beklenmeyen ' + method + ' ' + path);
}

/* ---------------- Sahte Telegram / Meta ---------------- */
let tgCalls = [], graphCalls = [];
let tgFail = null;
function telegram(u, body) {
  const method = u.pathname.split('/').pop();
  tgCalls.push({ method, body });
  if (!u.pathname.includes(TG_TOKEN)) return json(401, { ok: false, error_code: 401 });
  if (method === 'getMe') return json(200, { ok: true, result: { id: 777, is_bot: true, username: 'isil_klinik_bot' } });
  if (method === 'sendMessage' && tgFail) return json(403, { ok: false, error_code: tgFail });
  return json(200, { ok: true, result: method === 'sendMessage' ? { message_id: 55 } : true });
}
function graph(u, method, body, headers) {
  graphCalls.push({ path: u.pathname + u.search, method, body });
  if (headers.Authorization !== 'Bearer ' + META_TOKEN) return json(401, { error: { code: 190 } });
  if (u.pathname.endsWith('/1099887766') && method === 'GET') return json(200, { display_phone_number: '+90 532 000 00 00', verified_name: 'Işıl Güzellik' });
  if (u.pathname.endsWith('/subscribed_apps')) return json(200, { success: true });
  if (u.pathname.endsWith('/me')) return json(200, { id: '5550001', name: 'Işıl Sayfa', instagram_business_account: { id: '17841400999', username: 'isilguzellik' } });
  if (u.pathname.endsWith('/messages')) return json(200, { messages: [{ id: 'wamid.OUT' }], message_id: 'mid.OUT' });
  return json(404, { error: { code: 100 } });
}

global.fetch = function (url, opts) {
  const u = new URL(String(url));
  const method = (opts && opts.method) || 'GET';
  const body = opts && opts.body ? JSON.parse(opts.body) : null;
  const headers = (opts && opts.headers) || {};
  if (u.host === 'db.test') return supabase(u, method, body, headers);
  if (u.host === 'api.telegram.org') return telegram(u, body);
  if (u.host === 'graph.facebook.com') return graph(u, method, body, headers);
  return Promise.reject(new Error('beklenmeyen ağ ' + u.href));
};

const secrets = require('../api/_atlas/channels/secrets.js');
const { adapterFor, chunk } = require('../api/_atlas/channels/adapter.js');
const store = require('../api/_atlas/channels/store.js');
const webhook = require('../api/atlas-channel-webhook.js');
const send = require('../api/atlas-channel-send.js');
const channelsApi = require('../api/atlas-channels.js');

let hata = 0;
function sina(ad, bulunan, beklenen) {
  const ok = JSON.stringify(bulunan) === JSON.stringify(beklenen);
  if (!ok) hata++;
  console.log((ok ? 'ok   ' : 'HATA ') + ad + (ok ? '' : ' — bulunan ' + JSON.stringify(bulunan) + ', beklenen ' + JSON.stringify(beklenen)));
}

/* Vercel benzeri yanıt yardımcıları ile gerçek HTTP sunucusu (webhook ham gövde). */
function vercelServer(handler) {
  return http.createServer(function (req, res) {
    const u = new URL(req.url, 'http://x');
    req.query = Object.fromEntries(u.searchParams);
    res.status = function (c) { res.statusCode = c; return res; };
    res.json = function (b) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(b)); return res; };
    res.send = function (b) { res.end(b); return res; };
    handler(req, res);
  });
}
function hit(port, path, opts) {
  return new Promise(function (resolve) {
    const data = opts && opts.body !== undefined ? (Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(opts.body)) : null;
    const r = http.request({ port, path, method: (opts && opts.method) || 'GET', headers: Object.assign({ 'Content-Type': 'application/json' }, (opts && opts.headers) || {}) }, function (res) {
      let b = ''; res.on('data', function (c) { b += c; }); res.on('end', function () { resolve({ status: res.statusCode, body: b }); });
    });
    if (data) r.write(data);
    r.end();
  });
}
function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.setHeader = function (k, v) { res.headers[k.toLowerCase()] = v; };
  res.status = function (c) { res.statusCode = c; return res; };
  res.json = function (b) { res.body = b; return res; };
  res.send = function (b) { res.body = b; return res; };
  res.end = function () { return res; };
  return res;
}
async function call(handler, req) {
  const res = fakeRes();
  await handler(Object.assign({ headers: {}, query: {} }, req), res);
  return res;
}
const sign = (raw) => 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex');

(async function () {
  /* ---- Şifreleme ---- */
  const sealed = secrets.seal({ botToken: TG_TOKEN });
  sina('şifreleme: geri açılır', secrets.open(sealed), { botToken: TG_TOKEN });
  sina('şifreleme: düz metin jeton içermez', sealed.includes(TG_TOKEN.slice(10)), false);
  const bozuk = sealed.slice(0, -4) + (sealed.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
  let threw = false; try { secrets.open(bozuk); } catch (e) { threw = true; }
  sina('şifreleme: değiştirilmiş veri reddedilir', threw, true);
  sina('parçalama: 5000 karakter → 2 parça (Telegram)', chunk('a '.repeat(2500), 4096).length, 2);

  const telegram = adapterFor('telegram'), whatsapp = adapterFor('whatsapp'), instagram = adapterFor('instagram');

  /* ---- Telegram ---- */
  let r = await telegram.connect(ORG_A, { botToken: 'yanlis' });
  sina('telegram: biçimsiz token reddedilir (ağa çıkmadan)', [r.success, r.error, tgCalls.length], [false, 'token_format', 0]);
  r = await telegram.connect(ORG_A, { botToken: TG_TOKEN });
  const tgConn = T.channel_connections.find(function (c) { return c.channel === 'telegram'; });
  const setHook = tgCalls.find(function (c) { return c.method === 'setWebhook'; });
  sina('telegram: bağlandı', [r.success, r.status, tgConn.status, tgConn.display_name], [true, 'connected', 'connected', '@isil_klinik_bot']);
  sina('telegram: webhook kliniğe özel adres + secret_token', [setHook.body.url, setHook.body.secret_token === tgConn.webhook_secret, setHook.body.allowed_updates],
    ['https://atlasasistan.com/api/atlas-channel-webhook?c=' + tgConn.id, true, ['message']]);
  sina('telegram: token veritabanında şifreli', [tgConn.secrets.startsWith('v1:'), tgConn.secrets.includes(TG_TOKEN)], ['true' === 'true', false]);
  const tgFull = await store.byId(tgConn.id);
  sina('telegram: secret_token başlığı doğru → geçer', await telegram.verifyWebhook({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': tgConn.webhook_secret }, connection: tgFull }), true);
  sina('telegram: yanlış/eksik başlık → reddedilir', [
    await telegram.verifyWebhook({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'x' }, connection: tgFull }),
    await telegram.verifyWebhook({ method: 'POST', headers: {}, connection: tgFull })], [false, false]);
  const tgUpd = { update_id: 1, message: { message_id: 9, date: 1700000000, chat: { id: 4242, type: 'private' }, from: { id: 4242, first_name: 'Ayşe', last_name: 'Y' }, text: ' Merhaba ' } };
  sina('telegram: özel sohbet metni ayrışır', telegram.parseIncoming(tgUpd, tgFull), {
    clinicId: ORG_A, channel: 'telegram', from: '4242', text: 'Merhaba', timestamp: 1700000000000, raw: tgUpd, externalId: '4242:9', name: 'Ayşe Y' });
  sina('telegram: grup / bot / metinsiz yok sayılır', [
    telegram.parseAll({ message: Object.assign({}, tgUpd.message, { chat: { id: -1, type: 'group' } }) }, tgFull).length,
    telegram.parseAll({ message: Object.assign({}, tgUpd.message, { from: { is_bot: true } }) }, tgFull).length,
    telegram.parseAll({ message: Object.assign({}, tgUpd.message, { text: undefined, photo: [{}] }) }, tgFull).length], [0, 0, 0]);
  tgCalls = [];
  await telegram.sendMessage(ORG_A, '4242', 'x'.repeat(5000));
  sina('telegram: uzun cevap iki mesajda gider', tgCalls.filter(function (c) { return c.method === 'sendMessage'; }).map(function (c) { return [c.body.chat_id, c.body.text.length]; }), [['4242', 4096], ['4242', 904]]);

  /* ---- WhatsApp ---- */
  r = await whatsapp.connect(ORG_A, { phoneNumberId: '12ab', wabaId: '1', accessToken: META_TOKEN, appSecret: APP_SECRET });
  sina('whatsapp: biçimsiz phone number id reddedilir', [r.success, r.error], [false, 'phone_number_id']);
  r = await whatsapp.connect(ORG_A, { phoneNumberId: '1099887766', wabaId: '2233445566', accessToken: META_TOKEN, appSecret: 'kisa' });
  sina('whatsapp: biçimsiz App Secret reddedilir', r.error, 'app_secret');
  graphCalls = [];
  r = await whatsapp.connect(ORG_A, { phoneNumberId: '1099887766', wabaId: '2233445566', accessToken: META_TOKEN, appSecret: APP_SECRET });
  const waConn = T.channel_connections.find(function (c) { return c.channel === 'whatsapp'; });
  sina('whatsapp: numara doğrulandı → bekliyor + webhook adresi', [r.success, r.status, r.webhookUrl], [true, 'pending', 'https://atlasasistan.com/api/atlas-channel-webhook?c=' + waConn.id]);
  sina('whatsapp: uygulama WABA\'ya abone edildi', graphCalls.some(function (c) { return c.path.includes('/2233445566/subscribed_apps') && c.method === 'POST'; }), true);
  sina('whatsapp: görünen ad', waConn.display_name, 'Işıl Güzellik · +90 532 000 00 00');

  /* ---- Webhook ucu: gerçek HTTP (ham gövde) ---- */
  const srv = vercelServer(webhook);
  await new Promise(function (ok) { srv.listen(0, ok); });
  const port = srv.address().port;

  let h = await hit(port, '/api/atlas-channel-webhook?c=' + waConn.id + '&hub.mode=subscribe&hub.verify_token=yanlis&hub.challenge=123');
  sina('meta doğrulama: yanlış verify token → 403', h.status, 403);
  h = await hit(port, '/api/atlas-channel-webhook?c=' + waConn.id + '&hub.mode=subscribe&hub.verify_token=' + waConn.webhook_secret + '&hub.challenge=987654');
  sina('meta doğrulama: doğru → challenge düz metin, bağlantı connected', [h.status, h.body, waConn.status], [200, '987654', 'connected']);

  /* Meta gövdesini \\u kaçışlarıyla yazar: yeniden yazılan JSON imzayı tutmaz — ham gövde şart. */
  const waRaw = '{"object":"whatsapp_business_account","entry":[{"id":"2233445566","changes":[{"field":"messages","value":{"messaging_product":"whatsapp",' +
    '"metadata":{"display_phone_number":"905320000000","phone_number_id":"1099887766"},"contacts":[{"profile":{"name":"Ay\\u015fe"},"wa_id":"905339998877"}],' +
    '"messages":[{"from":"905339998877","id":"wamid.IN1","timestamp":"1700000000","type":"text","text":{"body":"Lazer ne kadar?"}}]}}]}]}';
  inboundCalls = [];
  h = await hit(port, '/api/atlas-channel-webhook?c=' + waConn.id, { method: 'POST', body: waRaw, headers: { 'X-Hub-Signature-256': sign(Buffer.from(waRaw)) } });
  sina('whatsapp webhook: imzalı (ham gövde, \\u kaçışlı) → 200, 1 mesaj', [h.status, JSON.parse(h.body).written], [200, 1]);
  sina('whatsapp webhook: kurum bağlantıdan, ad çözülmüş', [inboundCalls[0].p_org, inboundCalls[0].p_channel, inboundCalls[0].p_from, inboundCalls[0].p_name, inboundCalls[0].p_external_id],
    [ORG_A, 'whatsapp', '905339998877', 'Ayşe', 'wamid.IN1']);
  h = await hit(port, '/api/atlas-channel-webhook?c=' + waConn.id, { method: 'POST', body: waRaw.replace('Lazer', 'Botoks'), headers: { 'X-Hub-Signature-256': sign(Buffer.from(waRaw)) } });
  sina('whatsapp webhook: değiştirilmiş gövde → 401, yazılmaz', [h.status, inboundCalls.length], [401, 1]);
  h = await hit(port, '/api/atlas-channel-webhook?c=' + waConn.id, { method: 'POST', body: waRaw });
  sina('whatsapp webhook: imzasız → 401', h.status, 401);
  const foreign = waRaw.replace('"phone_number_id":"1099887766"', '"phone_number_id":"5555555555"');
  h = await hit(port, '/api/atlas-channel-webhook?c=' + waConn.id, { method: 'POST', body: foreign, headers: { 'X-Hub-Signature-256': sign(Buffer.from(foreign)) } });
  sina('whatsapp webhook: başka numaranın olayı (imzalı da olsa) yazılmaz', [h.status, JSON.parse(h.body).received, inboundCalls.length], [200, 0, 1]);
  const statusOnly = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1099887766' }, statuses: [{ id: 'wamid.OUT', status: 'delivered' }] } }] }] });
  h = await hit(port, '/api/atlas-channel-webhook?c=' + waConn.id, { method: 'POST', body: statusOnly, headers: { 'X-Hub-Signature-256': sign(Buffer.from(statusOnly)) } });
  sina('whatsapp webhook: yalnız durum olayı → 200, mesaj yok', [h.status, JSON.parse(h.body).received], [200, 0]);

  const tgRaw = JSON.stringify(tgUpd);
  h = await hit(port, '/api/atlas-channel-webhook?c=' + tgConn.id, { method: 'POST', body: tgRaw, headers: { 'X-Telegram-Bot-Api-Secret-Token': tgConn.webhook_secret } });
  sina('telegram webhook: doğru secret → yazıldı', [h.status, inboundCalls[inboundCalls.length - 1].p_external_id, inboundCalls[inboundCalls.length - 1].p_org], [200, '4242:9', ORG_A]);
  h = await hit(port, '/api/atlas-channel-webhook?c=' + tgConn.id, { method: 'POST', body: tgRaw, headers: { 'X-Telegram-Bot-Api-Secret-Token': waConn.webhook_secret } });
  sina('telegram webhook: başka bağlantının secret\'ı → 401', h.status, 401);
  h = await hit(port, '/api/atlas-channel-webhook?c=00000000-0000-4000-a000-999999999999', { method: 'POST', body: tgRaw });
  sina('webhook: bilinmeyen bağlantı → 404', h.status, 404);
  h = await hit(port, '/api/atlas-channel-webhook?c=' + tgConn.id + '&hub.mode=subscribe&hub.verify_token=' + tgConn.webhook_secret + '&hub.challenge=1');
  sina('webhook: Telegram\'da GET doğrulaması yok → 405', h.status, 405);

  /* ---- Instagram ---- */
  r = await instagram.connect(ORG_A, { pageAccessToken: META_TOKEN, appSecret: APP_SECRET });
  const igConn = T.channel_connections.find(function (c) { return c.channel === 'instagram'; });
  sina('instagram: hesap bulundu → bekliyor', [r.success, r.status, igConn.external_id, igConn.display_name], [true, 'pending', '17841400999', '@isilguzellik']);
  await hit(port, '/api/atlas-channel-webhook?c=' + igConn.id + '&hub.mode=subscribe&hub.verify_token=' + igConn.webhook_secret + '&hub.challenge=5');
  const igRaw = JSON.stringify({ object: 'instagram', entry: [{ id: '17841400999', time: 1, messaging: [
    { sender: { id: '900' }, recipient: { id: '17841400999' }, timestamp: 1700000000000, message: { mid: 'mid.IN', text: 'Merhaba' } },
    { sender: { id: '17841400999' }, recipient: { id: '900' }, timestamp: 1700000000001, message: { mid: 'mid.ECHO', text: 'cevap', is_echo: true } }] }] });
  inboundCalls = [];
  h = await hit(port, '/api/atlas-channel-webhook?c=' + igConn.id, { method: 'POST', body: igRaw, headers: { 'X-Hub-Signature-256': sign(Buffer.from(igRaw)) } });
  sina('instagram webhook: müşteri mesajı yazılır, yankı (is_echo) atlanır', [h.status, inboundCalls.map(function (c) { return c.p_external_id; })], [200, ['mid.IN']]);
  const igForeign = igRaw.split('17841400999').join('17841400111');
  h = await hit(port, '/api/atlas-channel-webhook?c=' + igConn.id, { method: 'POST', body: igForeign, headers: { 'X-Hub-Signature-256': sign(Buffer.from(igForeign)) } });
  sina('instagram webhook: başka hesabın olayı yazılmaz', [JSON.parse(h.body).received, inboundCalls.length], [0, 1]);
  srv.close();

  /* ---- Gönderim ucu ---- */
  T.customers.push({ id: 'cust-tg', organization_id: ORG_A, external_channel: 'telegram', external_id: '4242' });
  T.messages.push({ id: '00000000-0000-4000-c000-000000000001', organization_id: ORG_A, customer_id: 'cust-tg', channel: 'telegram', content: 'Merhaba! Fiyat 1.000 TL.', is_from_customer: false, delivery_status: null });
  r = await call(send, { method: 'POST', headers: { 'x-atlas-secret': 'e'.repeat(64) }, body: { message_id: '00000000-0000-4000-c000-000000000001' } });
  sina('gönderim: yanlış gizli değer → 401', r.statusCode, 401);
  tgCalls = [];
  r = await call(send, { method: 'POST', headers: { 'x-atlas-secret': SEND_SECRET }, body: { message_id: '00000000-0000-4000-c000-000000000001' } });
  sina('gönderim: Telegram\'a gitti, durum sent', [r.body.sent, tgCalls[0].body, T.messages[0].delivery_status], [true, { chat_id: '4242', text: 'Merhaba! Fiyat 1.000 TL.' }, 'sent']);
  r = await call(send, { method: 'POST', headers: { 'x-atlas-secret': SEND_SECRET }, body: { message_id: '00000000-0000-4000-c000-000000000001' } });
  sina('gönderim: ikinci tetik → ikinci kez gitmez', [r.body.skipped, tgCalls.length], ['already_handled', 1]);
  T.messages.push({ id: '00000000-0000-4000-c000-000000000002', organization_id: ORG_A, customer_id: 'cust-tg', channel: 'telegram', content: 'x', is_from_customer: false, delivery_status: null });
  tgFail = 403;
  r = await call(send, { method: 'POST', headers: { 'x-atlas-secret': SEND_SECRET }, body: { message_id: '00000000-0000-4000-c000-000000000002' } });
  sina('gönderim: sağlayıcı reddi → failed + kod', [r.body.failed, T.messages[1].delivery_status, T.messages[1].delivery_error], ['telegram_403', 'failed', 'telegram_403']);
  tgFail = null;
  T.customers.push({ id: 'cust-wa', organization_id: ORG_A, external_channel: 'whatsapp', external_id: '905339998877' });
  T.messages.push({ id: '00000000-0000-4000-c000-000000000003', organization_id: ORG_A, customer_id: 'cust-wa', channel: 'whatsapp', content: 'WA cevap', is_from_customer: false, delivery_status: null });
  graphCalls = [];
  r = await call(send, { method: 'POST', headers: { 'x-atlas-secret': SEND_SECRET }, body: { message_id: '00000000-0000-4000-c000-000000000003' } });
  sina('gönderim: WhatsApp Cloud API biçimi', [r.body.sent, graphCalls[0].path, graphCalls[0].body], [true, '/v21.0/1099887766/messages',
    { messaging_product: 'whatsapp', recipient_type: 'individual', to: '905339998877', type: 'text', text: { body: 'WA cevap', preview_url: false } }]);

  /* ---- Panel ucu ---- */
  r = await call(channelsApi, { method: 'GET', headers: {} });
  sina('panel: oturumsuz → 401', r.statusCode, 401);
  r = await call(channelsApi, { method: 'GET', headers: { authorization: RECEP } });
  const recepWa = r.body.channels.find(function (c) { return c.channel === 'whatsapp'; });
  sina('panel: resepsiyon listeyi görür ama Meta değerlerini görmez', [r.statusCode, r.body.canManage, recepWa.status, recepWa.verifyToken], [200, false, 'connected', null]);
  r = await call(channelsApi, { method: 'GET', headers: { authorization: OWNER } });
  const body = JSON.stringify(r.body);
  sina('panel: listede jeton/App Secret/şifreli değer yok', [body.includes(TG_TOKEN), body.includes(APP_SECRET), body.includes('v1:'), body.includes(META_TOKEN)], [false, false, false, false]);
  sina('panel: sahip Meta webhook değerlerini görür', !!r.body.channels.find(function (c) { return c.channel === 'whatsapp'; }).verifyToken, true);
  r = await call(channelsApi, { method: 'POST', headers: { authorization: RECEP }, body: { action: 'disconnect', channel: 'telegram' } });
  sina('panel: resepsiyon kanal kesemez → 403', r.statusCode, 403);
  r = await call(channelsApi, { method: 'POST', headers: { authorization: OWNER }, body: { action: 'disconnect', channel: 'telegram' } });
  sina('panel: sahip keser → jeton silinir, webhook kaldırılır', [r.statusCode, tgConn.status, tgConn.secrets, tgCalls.some(function (c) { return c.method === 'deleteWebhook'; })], [200, 'disconnected', null, true]);

  /* İzolasyon: B kurumu aynı WhatsApp numarasını bağlayamaz */
  const waB = await whatsapp.connect(ORG_B, { phoneNumberId: '1099887766', wabaId: '2233445566', accessToken: META_TOKEN, appSecret: APP_SECRET });
  sina('izolasyon: aynı numara ikinci kuruma bağlanamaz', [waB.success, waB.error], [false, 'already_connected_elsewhere']);

  console.log(hata ? '\n' + hata + ' sınama BAŞARISIZ' : '\nTümü geçti');
  process.exit(hata ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
