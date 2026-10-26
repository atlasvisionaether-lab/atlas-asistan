'use strict';
/**
 * WhatsApp "tek tıkla bağla" (Embedded Signup v4) + Atlas uygulama webhook'u + coexistence.
 *
 *   node tools/atlas-embedded-signup-test.js
 *
 * Ağ yok: sahte Supabase (bellekte), sahte Meta Graph (kod değişimi, WABA
 * numaraları, abonelik, kayıt). Webhook GERÇEK Node HTTP sunucusu üzerinden:
 * imza ham baytlarla, Atlas App Secret'ıyla sınanır.
 */

const http = require('node:http');
const crypto = require('node:crypto');

const ORG_A = '00000000-0000-4000-a000-00000000000a';
const ORG_B = '00000000-0000-4000-a000-00000000000b';
const OWNER = 'Bearer ' + 'o'.repeat(40);
const OWNER_B = 'Bearer ' + 'b'.repeat(40);
const RECEP = 'Bearer ' + 'r'.repeat(40);
const U_OWNER = '00000000-0000-4000-a000-0000000000a1';
const U_OWNER_B = '00000000-0000-4000-a000-0000000000b1';
const U_RECEP = '00000000-0000-4000-a000-0000000000a2';
const APP_ID = '1234567890123';
const APP_SECRET = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
const CONFIG_ID = '9876543210987';
const VERIFY = 'atlas-verify-token-0123456789';
const CODE = 'AQD' + 'c'.repeat(60);
const BIZ_TOKEN = 'EAAB' + 'z'.repeat(80);
const WABA = '102030405060';
const PHONE = '1099887766';
const OTHER_PHONE = '5544332211';

Object.assign(process.env, {
  SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key-xxxxxxxxxxxxxxxx',
  CHANNEL_ENC_KEY: crypto.randomBytes(32).toString('hex'), SITE_URL: 'https://atlasasistan.com'
});
delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.ATLAS_PANEL_URL;
const META_ENV = { META_APP_ID: APP_ID, META_APP_SECRET: APP_SECRET, META_ES_CONFIG_ID: CONFIG_ID, META_WEBHOOK_VERIFY_TOKEN: VERIFY };

/* ---------------- Sahte Supabase ---------------- */
const T = { channel_connections: [] };
let inboundCalls = [], echoCalls = [];
let seq = 0;
const uid = () => '00000000-0000-4000-b000-' + String(++seq).padStart(12, '0');
function filterRows(rows, q) {
  return rows.filter(function (r) {
    let ok = true;
    q.forEach(function (v, k) {
      if (['select', 'limit', 'order', 'on_conflict'].includes(k)) return;
      if (v.startsWith('eq.') && String(r[k]) !== decodeURIComponent(v.slice(3))) ok = false;
      if (v.startsWith('neq.') && String(r[k]) === decodeURIComponent(v.slice(4))) ok = false;
    });
    return ok;
  });
}
function json(status, body) { return Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })); }
function supabase(u, method, body, headers) {
  if (u.pathname === '/auth/v1/user') {
    const a = headers.Authorization;
    if (a === OWNER) return json(200, { id: U_OWNER });
    if (a === OWNER_B) return json(200, { id: U_OWNER_B });
    if (a === RECEP) return json(200, { id: U_RECEP });
    return json(401, {});
  }
  const path = u.pathname.replace('/rest/v1/', '');
  if (path === 'users') {
    const id = u.searchParams.get('id').slice(3);
    return json(200, [{ organization_id: id === U_OWNER_B ? ORG_B : ORG_A, role: id === U_RECEP ? 'receptionist' : 'owner' }]);
  }
  if (path === 'rpc/atlas_channel_inbound') { inboundCalls.push(body); return json(200, uid()); }
  if (path === 'rpc/atlas_channel_echo') { echoCalls.push(body); return json(200, uid()); }
  const rows = T[path];
  if (!rows) throw new Error('bilinmeyen tablo ' + path);
  if (method === 'GET') return json(200, filterRows(rows, u.searchParams).slice(0, Number(u.searchParams.get('limit')) || 1000));
  if (method === 'POST') {
    let row = rows.find(function (r) { return r.organization_id === body.organization_id && r.channel === body.channel; });
    if (row) Object.assign(row, body); else { row = Object.assign({ id: uid(), mode: 'manual' }, body); rows.push(row); }
    return json(201, [row]);
  }
  if (method === 'PATCH') {
    const hit = filterRows(rows, u.searchParams);
    if (body.external_id && ['pending', 'connected'].includes(body.status || hit[0].status)) {
      const clash = rows.find(function (r) { return r !== hit[0] && r.channel === hit[0].channel && r.external_id === body.external_id && ['pending', 'connected'].includes(r.status); });
      if (clash) return json(409, { code: '23505' });
    }
    hit.forEach(function (r) { Object.assign(r, body); });
    return json(200, hit);
  }
  throw new Error('beklenmeyen ' + method + ' ' + path);
}

/* ---------------- Sahte Meta Graph ---------------- */
let graphCalls = [];
let registerFails = false;
function graph(u, method, body, headers) {
  graphCalls.push({ path: u.pathname, method, body, auth: headers.Authorization || null, query: Object.fromEntries(u.searchParams) });
  if (u.pathname.endsWith('/oauth/access_token')) {
    const q = u.searchParams;
    if (q.get('client_id') === APP_ID && q.get('client_secret') === APP_SECRET && q.get('code') === CODE) return json(200, { access_token: BIZ_TOKEN, token_type: 'bearer' });
    return json(400, { error: { code: 100, error_subcode: 36007 } });
  }
  if (headers.Authorization !== 'Bearer ' + BIZ_TOKEN) return json(401, { error: { code: 190 } });
  if (u.pathname.endsWith('/' + WABA + '/phone_numbers')) return json(200, { data: [{ id: PHONE, display_phone_number: '+90 532 000 00 00', verified_name: 'Işıl Güzellik' }] });
  if (u.pathname.includes('/phone_numbers')) return json(403, { error: { code: 200 } });   // jetonun erişemediği WABA
  if (u.pathname.endsWith('/subscribed_apps')) return json(200, { success: true });
  if (u.pathname.endsWith('/' + PHONE + '/register')) return registerFails ? json(400, { error: { code: 133005 } }) : json(200, { success: true });
  if (u.pathname.endsWith('/messages')) return json(200, { messages: [{ id: 'wamid.OUT' }] });
  return json(404, { error: { code: 100 } });
}

global.fetch = function (url, opts) {
  const u = new URL(String(url));
  const method = (opts && opts.method) || 'GET';
  const body = opts && opts.body ? JSON.parse(opts.body) : null;
  const headers = (opts && opts.headers) || {};
  if (u.host === 'db.test') return supabase(u, method, body, headers);
  if (u.host === 'graph.facebook.com') return graph(u, method, body, headers);
  return Promise.reject(new Error('beklenmeyen ağ ' + u.href));
};

const store = require('../api/_atlas/channels/store.js');
const whatsapp = require('../api/_atlas/channels/whatsapp.js');
const webhook = require('../api/atlas-channel-webhook.js');
const channelsApi = require('../api/atlas-channels.js');

let hata = 0;
function sina(ad, bulunan, beklenen) {
  const ok = JSON.stringify(bulunan) === JSON.stringify(beklenen);
  if (!ok) hata++;
  console.log((ok ? 'ok   ' : 'HATA ') + ad + (ok ? '' : ' — bulunan ' + JSON.stringify(bulunan) + ', beklenen ' + JSON.stringify(beklenen)));
}
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
    const data = opts && opts.body !== undefined ? Buffer.from(opts.body) : null;
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
async function call(handler, req) { const res = fakeRes(); await handler(Object.assign({ headers: {}, query: {} }, req), res); return res; }
const api = (body, auth) => call(channelsApi, { method: 'POST', headers: { authorization: auth || OWNER, origin: 'https://atlas-asistan-panel-preview.vercel.app' }, body: body });
const sign = (raw, secret) => 'sha256=' + crypto.createHmac('sha256', secret || APP_SECRET).update(raw).digest('hex');
const conn = (org) => T.channel_connections.find(function (r) { return r.organization_id === (org || ORG_A) && r.channel === 'whatsapp'; });
const signup = (extra, auth) => api(Object.assign({ action: 'embeddedSignup', channel: 'whatsapp', code: CODE, wabaId: WABA, phoneNumberId: PHONE }, extra || {}), auth);
const event = (field, value, entryId) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: entryId || WABA, changes: [{ field: field, value: value }] }] });
const meta = (phone) => ({ messaging_product: 'whatsapp', metadata: { display_phone_number: '905320000000', phone_number_id: phone || PHONE } });

(async function () {
  /* ---- Yapılandırma yokken ---- */
  let r = await call(channelsApi, { method: 'GET', headers: { authorization: OWNER, origin: 'https://atlas-asistan-panel-preview.vercel.app' } });
  sina('env yok: panel tek tık düğmesini görmez', r.body.embedded, null);
  r = await signup();
  sina('env yok: embeddedSignup → server_config', [r.statusCode, r.body.error], [400, 'server_config']);

  Object.assign(process.env, META_ENV);
  r = await call(channelsApi, { method: 'GET', headers: { authorization: OWNER, origin: 'https://atlas-asistan-panel-preview.vercel.app' } });
  sina('env var: panele yalnız appId/configId/sürüm gider (App Secret ASLA)', [r.body.embedded.whatsapp.appId, r.body.embedded.whatsapp.configId, JSON.stringify(r.body).indexOf(APP_SECRET)], [APP_ID, CONFIG_ID, -1]);
  r = await call(channelsApi, { method: 'GET', headers: { authorization: RECEP, origin: 'https://atlas-asistan-panel-preview.vercel.app' } });
  sina('resepsiyon tek tık yapılandırmasını görmez', r.body.embedded, null);
  r = await signup({}, RECEP);
  sina('resepsiyon bağlayamaz → 403', r.statusCode, 403);

  /* ---- Girdi ve güvenlik ---- */
  r = await signup({ code: 'kisa' });
  sina('kısa kod → 400 code', r.body.error, 'code');
  r = await signup({ phoneNumberId: 'abc' });
  sina('geçersiz numara kimliği → session', r.body.error, 'session');
  graphCalls = [];
  r = await signup({ code: 'AQD' + 'x'.repeat(60) });
  sina('süresi dolmuş/yanlış kod → code_exchange, başka çağrı yok', [r.body.error, graphCalls.length], ['code_exchange', 1]);
  sina('kod değişimi App Secret ile sunucudan', [graphCalls[0].query.client_id, graphCalls[0].query.client_secret === APP_SECRET], [APP_ID, true]);
  r = await signup({ phoneNumberId: OTHER_PHONE });
  sina('tarayıcının bildirdiği numara WABA\'da yoksa → waba_mismatch', r.body.error, 'waba_mismatch');
  r = await signup({ wabaId: '999999999999' });
  sina('jetonun erişemediği WABA → waba_mismatch', r.body.error, 'waba_mismatch');
  sina('başarısız denemeler bağlantı satırı açmaz', T.channel_connections.length, 0);

  /* ---- Yeni numara (kayıt dahil) ---- */
  graphCalls = [];
  r = await signup();
  const c1 = conn();
  sina('yeni numara: bağlandı (embedded, connected)', [r.statusCode, r.body.success, c1.status, c1.mode, c1.account_id, c1.external_id], [200, true, 'connected', 'embedded', WABA, PHONE]);
  sina('yeni numara: sıra = kod → numaralar → abonelik → kayıt', graphCalls.map(function (g) { return g.method + ' ' + g.path.replace(/^\/v[\d.]+/, ''); }),
    ['GET /oauth/access_token', 'GET /' + WABA + '/phone_numbers', 'POST /' + WABA + '/subscribed_apps', 'POST /' + PHONE + '/register']);
  const reg = graphCalls[3].body;
  sina('kayıt: 6 haneli rastgele PIN', [reg.messaging_product, /^\d{6}$/.test(reg.pin)], ['whatsapp', true]);
  const creds = (await store.byOrg(ORG_A, 'whatsapp')).creds;
  sina('jeton + PIN şifreli saklanır (düz metin yok)', [creds.accessToken, creds.pin === reg.pin, c1.secrets.indexOf(BIZ_TOKEN)], [BIZ_TOKEN, true, -1]);
  sina('panel görünümü: webhook adresi/jetonu gösterilmez, mod embedded', [r.body.channel.mode, r.body.channel.webhookUrl, r.body.channel.verifyToken, r.body.channel.displayName], ['embedded', null, null, 'Işıl Güzellik · +90 532 000 00 00']);

  r = await signup({}, OWNER_B);
  sina('aynı numara başka klinikte → already_connected_elsewhere', [r.statusCode, r.body.error], [400, 'already_connected_elsewhere']);

  /* ---- Uygulama webhook'u ---- */
  const srv = vercelServer(webhook);
  await new Promise(function (ok) { srv.listen(0, ok); });
  const port = srv.address().port;
  let w = await hit(port, '/api/atlas-channel-webhook?app=meta&hub.mode=subscribe&hub.verify_token=' + VERIFY + '&hub.challenge=4242');
  sina('webhook doğrulama (GET) → challenge', [w.status, w.body], [200, '4242']);
  w = await hit(port, '/api/atlas-channel-webhook?app=meta&hub.mode=subscribe&hub.verify_token=yanlis-jeton-0000000&hub.challenge=1');
  sina('yanlış doğrulama jetonu → 403', w.status, 403);

  const msg = event('messages', Object.assign(meta(), { contacts: [{ wa_id: '905551112233', profile: { name: 'Ayşe' } }], messages: [{ from: '905551112233', id: 'wamid.IN1', timestamp: '1761450000', type: 'text', text: { body: 'Merhaba, randevu almak istiyorum' } }] }));
  w = await hit(port, '/api/atlas-channel-webhook?app=meta', { method: 'POST', body: msg, headers: { 'X-Hub-Signature-256': sign(msg, 'f'.repeat(32)) } });
  sina('başka gizli anahtarla imza → 401, yazılmaz', [w.status, inboundCalls.length], [401, 0]);
  w = await hit(port, '/api/atlas-channel-webhook?app=meta', { method: 'POST', body: msg });
  sina('imzasız → 401', w.status, 401);
  w = await hit(port, '/api/atlas-channel-webhook?app=meta', { method: 'POST', body: msg, headers: { 'X-Hub-Signature-256': sign(msg) } });
  sina('gelen mesaj kliniğe yönlendi', [w.status, inboundCalls.length, inboundCalls[0] && inboundCalls[0].p_org, inboundCalls[0] && inboundCalls[0].p_from, inboundCalls[0] && inboundCalls[0].p_name], [200, 1, ORG_A, '905551112233', 'Ayşe']);

  const stranger = event('messages', Object.assign(meta(OTHER_PHONE), { messages: [{ from: '905550000000', id: 'wamid.X', type: 'text', text: { body: 'selam' } }] }));
  w = await hit(port, '/api/atlas-channel-webhook?app=meta', { method: 'POST', body: stranger, headers: { 'X-Hub-Signature-256': sign(stranger) } });
  sina('tanınmayan numara: 200 ama yazılmaz', [w.status, inboundCalls.length], [200, 1]);

  const status = event('messages', Object.assign(meta(), { statuses: [{ id: 'wamid.OUT', status: 'delivered' }] }));
  w = await hit(port, '/api/atlas-channel-webhook?app=meta', { method: 'POST', body: status, headers: { 'X-Hub-Signature-256': sign(status) } });
  sina('durum olayı mesaj yazmaz', [w.status, inboundCalls.length], [200, 1]);

  /* ---- Coexistence yankısı ---- */
  const echoEv = event('smb_message_echoes', Object.assign(meta(), { message_echoes: [{ from: '905320000000', to: '905551112233', id: 'wamid.ECHO1', timestamp: '1761450100', type: 'text', text: { body: 'Yarın 14:00 uygun, bekliyoruz.' } }] }));
  w = await hit(port, '/api/atlas-channel-webhook?app=meta', { method: 'POST', body: echoEv, headers: { 'X-Hub-Signature-256': sign(echoEv) } });
  sina('telefondan yazılan mesaj yankı olarak yazılır (gelen sayılmaz)', [w.status, JSON.parse(w.body).echoes, inboundCalls.length, echoCalls[0] && echoCalls[0].p_to, echoCalls[0] && echoCalls[0].p_external_id], [200, 1, 1, '905551112233', 'wamid.ECHO1']);
  const echoOther = event('smb_message_echoes', Object.assign(meta(OTHER_PHONE), { message_echoes: [{ to: '905551112233', id: 'wamid.E2', type: 'text', text: { body: 'x' } }] }));
  await hit(port, '/api/atlas-channel-webhook?app=meta', { method: 'POST', body: echoOther, headers: { 'X-Hub-Signature-256': sign(echoOther) } });
  sina('başka numaranın yankısı yazılmaz', echoCalls.length, 1);

  /* ---- Gönderim işletme jetonuyla ---- */
  graphCalls = [];
  await whatsapp.sendMessage(ORG_A, '905551112233', 'Randevunuz oluşturuldu.');
  sina('gönderim: işletme jetonu + numara kimliği', [graphCalls[0].path.endsWith('/' + PHONE + '/messages'), graphCalls[0].auth], [true, 'Bearer ' + BIZ_TOKEN]);

  /* ---- Bağlantı kesme: abonelik kalkar, jeton silinir ---- */
  graphCalls = [];
  r = await api({ action: 'disconnect', channel: 'whatsapp' });
  sina('kes: Atlas aboneliği kaldırılır, jeton silinir', [r.statusCode, graphCalls[0] && graphCalls[0].method + ' ' + graphCalls[0].path.replace(/^\/v[\d.]+/, ''), conn().status, conn().secrets], [200, 'DELETE /' + WABA + '/subscribed_apps', 'disconnected', null]);
  inboundCalls = [];
  w = await hit(port, '/api/atlas-channel-webhook?app=meta', { method: 'POST', body: msg, headers: { 'X-Hub-Signature-256': sign(msg) } });
  sina('kesildikten sonra gelen mesaj yazılmaz', inboundCalls.length, 0);

  /* ---- Coexistence bağlantısı: kayıt ATLANIR ---- */
  graphCalls = [];
  r = await signup({ coexistence: true });
  sina('coexistence: bağlandı, numara kaydı yapılmaz', [r.body.success, r.body.coexistence, graphCalls.some(function (g) { return g.path.endsWith('/register'); })], [true, true, false]);
  sina('coexistence: PIN yok', (await store.byOrg(ORG_A, 'whatsapp')).creds.pin, null);

  /* ---- Meta: klinik Atlas'ı WABA'sından kaldırdı ---- */
  const removedEv = event('account_update', { event: 'PARTNER_REMOVED', waba_info: { waba_id: WABA } });
  w = await hit(port, '/api/atlas-channel-webhook?app=meta', { method: 'POST', body: removedEv, headers: { 'X-Hub-Signature-256': sign(removedEv) } });
  sina('PARTNER_REMOVED → bağlantı kesilir, jeton silinir', [w.status, JSON.parse(w.body).removed, conn().status, conn().secrets], [200, 1, 'disconnected', null]);

  /* ---- Kayıt başarısızsa satır açılmaz ---- */
  registerFails = true;
  T.channel_connections.length = 0;
  r = await signup();
  sina('numara kaydı başarısız → hata, bağlantı yok', [r.statusCode, r.body.error, T.channel_connections.length], [400, 'meta_133005', 0]);
  registerFails = false;

  /* ---- Manual model bozulmadı: embedded bağlantı kliniğe özel adresi App Secret'sız kabul etmez ---- */
  await signup();
  const c2 = conn();
  const viaConn = event('messages', Object.assign(meta(), { messages: [{ from: '905551112233', id: 'wamid.IN9', type: 'text', text: { body: 'test' } }] }));
  inboundCalls = [];
  w = await hit(port, '/api/atlas-channel-webhook?c=' + c2.id, { method: 'POST', body: viaConn, headers: { 'X-Hub-Signature-256': sign(viaConn, 'e'.repeat(32)) } });
  sina('embedded bağlantının ?c= adresi: yanlış imza → 401', [w.status, inboundCalls.length], [401, 0]);

  srv.close();
  console.log(hata ? '\n' + hata + ' sınama BAŞARISIZ' : '\nTümü geçti');
  process.exit(hata ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
