'use strict';
/**
 * Klinik sahibi rehberi: /api/atlas-guide sınaması.
 *
 *   node tools/atlas-guide-test.js
 *
 * Ağ yok: global fetch sahte — Supabase Auth (/auth/v1/user), PostgREST
 * (users, organizations, atlas_guide_usage) ve DeepSeek (SSE akışı).
 *
 * Sınananlar: konu listesi (GET, LLM'siz); CORS; oturumsuz 401; geçersiz
 * adım 400; uzun soru 400; DeepSeek'e giden sistem metninde ELI10 kuralları
 * ve YALNIZ o adımın bilgileri; soru + geçmişin iletilmesi; markdown'ın
 * temizlenmesi; günlük sınır 429; sayaç tablosu yoksa çalışmaya devam;
 * DeepSeek düşerse 502 + facts; anahtar yoksa 503 + facts.
 */

const UID = '11111111-1111-4111-8111-111111111111';
const ORG = '33333333-3333-4333-8333-333333333333';
const PANEL = 'https://atlas-asistan-panel-preview.vercel.app';
const GOOD = 'Bearer ' + 'a'.repeat(40);

Object.assign(process.env, {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-xxxxxxxxxxxxxxxx',
  DEEPSEEK_API_KEY: 'sk-deepseek-test-key-0123456789abcdef',
  GUIDE_DAILY_LIMIT: '3'
});
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ATLAS_PANEL_URL;
delete process.env.TELEGRAM_BOT_TOKEN;

let deepseekCalls = [];
let usageRows = 0;
let usageTableMissing = false;
let deepseekDown = false;
let reply = 'Merhaba! **Kurulum** ekranı bir yapılacaklar listesi gibidir.\n1. Menüden Kurulum\'a girin.';

function json(status, body) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } }));
}
function sse(text) {
  const chunks = [text.slice(0, 10), text.slice(10)].map(function (t) {
    return 'data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + '\n\n';
  });
  chunks.push('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n');
  chunks.push('data: [DONE]\n\n');
  return Promise.resolve(new Response(chunks.join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
}

global.fetch = function (url, opts) {
  const u = String(url);
  const method = (opts && opts.method) || 'GET';
  if (u === 'https://db.test/auth/v1/user') {
    return opts.headers.Authorization === GOOD ? json(200, { id: UID, email: 'ayse@ornek.com' }) : json(401, {});
  }
  if (u.startsWith('https://db.test/rest/v1/users?')) return json(200, [{ organization_id: ORG, role: 'receptionist' }]);
  if (u.startsWith('https://db.test/rest/v1/organizations?')) return json(200, [{ name: 'Işıl Güzellik' }]);
  if (u.startsWith('https://db.test/rest/v1/atlas_guide_usage')) {
    if (usageTableMissing) return json(404, { code: '42P01' });
    if (method === 'POST') { usageRows += 1; return json(201, null); }
    return json(200, Array.from({ length: usageRows }, function (_, i) { return { id: i }; }));
  }
  if (u === 'https://api.deepseek.com/chat/completions') {
    deepseekCalls.push(JSON.parse(opts.body));
    if (deepseekDown) return json(500, {});
    return sse(reply);
  }
  return Promise.reject(new Error('beklenmeyen istek: ' + method + ' ' + u));
};

const guideHandler = require('../api/atlas-guide.js');

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.setHeader = function (k, v) { res.headers[k.toLowerCase()] = v; };
  res.status = function (c) { res.statusCode = c; return res; };
  res.json = function (b) { res.body = b; return res; };
  res.end = function () { return res; };
  return res;
}
async function call(req) {
  const res = fakeRes();
  await guideHandler(Object.assign({ headers: { origin: PANEL }, query: {} }, req), res);
  return res;
}
function post(body, auth) {
  return call({ method: 'POST', headers: { origin: PANEL, authorization: auth === undefined ? GOOD : auth }, body: body });
}

let hata = 0;
function sina(ad, bulunan, beklenen) {
  const ok = JSON.stringify(bulunan) === JSON.stringify(beklenen);
  if (!ok) hata++;
  console.log((ok ? 'ok   ' : 'HATA ') + ad + (ok ? '' : ' — bulunan ' + JSON.stringify(bulunan) + ', beklenen ' + JSON.stringify(beklenen)));
}

(async function () {
  let r = await call({ method: 'GET' });
  sina('GET → konu listesi', [r.statusCode, r.body.enabled, r.body.topics.map(function (t) { return t.id; })],
    [200, true, ['kurulum', 'whatsapp', 'hizmetler', 'test', 'site', 'takvim']]);
  sina('GET → CORS panel origin', r.headers['access-control-allow-origin'], PANEL);
  sina('GET → DeepSeek çağrılmadı', deepseekCalls.length, 0);

  r = await post({ topic: 'kurulum', step: 0 }, null);
  sina('oturumsuz → 401', r.statusCode, 401);
  r = await post({ topic: 'yok', step: 0 });
  sina('bilinmeyen konu → 400', r.statusCode, 400);
  r = await post({ topic: 'kurulum', step: 9 });
  sina('aralık dışı adım → 400', r.statusCode, 400);
  r = await post({ topic: 'kurulum', step: 0, question: 'x'.repeat(501) });
  sina('501 karakterlik soru → 400', r.statusCode, 400);

  r = await post({ topic: 'kurulum', step: 0 });
  sina('adım anlatımı → 200 (resepsiyon da kullanabilir)', [r.statusCode, r.body.step, r.body.total], [200, 0, 4]);
  sina('markdown temizlendi', r.body.text, 'Merhaba! Kurulum ekranı bir yapılacaklar listesi gibidir.\n1. Menüden Kurulum\'a girin.');
  const sys = deepseekCalls[0].messages[0].content;
  sina('sistem metni: ELI10', /10 yaşındaki/.test(sys), true);
  sina('sistem metni: uydurma yasağı', /UYDURMA/.test(sys), true);
  sina('sistem metni: şifre/kod isteme yasağı', /doğrulama kodu/.test(sys), true);
  sina('sistem metni: bu adımın bilgisi var', /Adımlar kendiliğinden işaretlenir/.test(sys), true);
  sina('sistem metni: başka adımın bilgisi yok', /iyzico/.test(sys), false);
  sina('sistem metni: klinik adı', /Klinik: Işıl Güzellik/.test(sys), true);
  sina('kullanıcı mesajı: adımı anlat', deepseekCalls[0].messages[1].content, '"Kurulum ekranı ne işe yarar?" adımını bana anlat.');

  r = await post({ topic: 'takvim', step: 1, question: 'Google Takvim bağlanır mı?',
    history: [{ role: 'user', content: 'önceki' }, { role: 'assistant', content: 'cevap' }, { role: 'system', content: 'kötü' }] });
  const son = deepseekCalls[deepseekCalls.length - 1];
  sina('soru + geçmiş iletildi, system rolü atıldı', son.messages.slice(1).map(function (m) { return m.role + ':' + m.content; }),
    ['user:önceki', 'assistant:cevap', 'user:Google Takvim bağlanır mı?']);
  sina('takvim adımı: senkron YOK bilgisi', /otomatik senkron şu an YOKTUR/.test(son.messages[0].content), true);

  r = await post({ topic: 'kurulum', step: 1 });
  sina('3. istek (sınır 3) → 200', r.statusCode, 200);
  r = await post({ topic: 'kurulum', step: 1 });
  sina('4. istek → 429 + facts', [r.statusCode, r.body.error.code, Array.isArray(r.body.facts)], [429, 'limit', true]);

  usageTableMissing = true;
  r = await post({ topic: 'kurulum', step: 1 });
  sina('sayaç tablosu yok → yine 200', r.statusCode, 200);
  usageTableMissing = false; usageRows = 0;

  deepseekDown = true;
  r = await post({ topic: 'whatsapp', step: 0 });
  sina('DeepSeek düştü → 502 + facts', [r.statusCode, r.body.error.code, r.body.facts.length > 0], [502, 'llm', true]);
  deepseekDown = false;

  delete process.env.DEEPSEEK_API_KEY;
  r = await post({ topic: 'whatsapp', step: 0 });
  sina('anahtar yok → 503 + facts', [r.statusCode, r.body.error.code, r.body.title], [503, 'unavailable', 'Hangi kanal, hangi numara?']);

  console.log(hata ? '\n' + hata + ' sınama BAŞARISIZ' : '\nTümü geçti');
  process.exit(hata ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
