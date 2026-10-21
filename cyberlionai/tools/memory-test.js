'use strict';

/**
 * Asistan hafızası + unutulma hakkı sınaması (Aşama 2).
 *
 *   api/_lib/memory.js · api/user/memory.js · api/user/delete.js
 *   api/deletion-certificate.js · api/panel/account.js · api/assistant-ai.js
 *
 * Sabitlenen kararlar:
 *   - Hafıza yalnızca giriş yapmış + "hatırla" demiş kullanıcıya yazılır;
 *     saklanan metin maskelidir, kullanıcı başına en çok KEEP (1000) mesaj kalır.
 *   - "Hayır, unut beni" kayıtlı konuşmaları anında siler.
 *   - Konuşmaları silen kullanıcı yeni kullanıcıdan AYIRT EDİLEMEZ: arayüz
 *     'first_time' alır, model "sizi ilk kez görüyorum" talimatını alır ve
 *     modele eski konuşma gitmez.
 *   - Sertifika tablosunda kullanıcı kimliği / e-posta / IP yok.
 *   - Bir kullanıcı başkasının hafızasını göremez, silemez.
 *
 * Ağ yok: Supabase PostgREST bellek içi sahte sunucuyla, DeepSeek sahte SSE
 * ile, kimlik ve depo saplamayla.
 */

const path = require('node:path');
const Module = require('node:module');

const API = path.join(__dirname, '..', 'api');

let gecti = 0;
const hatalar = [];
function dogru(ad, kosul) { if (kosul) { gecti += 1; return; } hatalar.push(ad); }
function esit(ad, bulunan, beklenen) {
  if (JSON.stringify(bulunan) === JSON.stringify(beklenen)) { gecti += 1; return; }
  hatalar.push(ad + ' (beklenen ' + JSON.stringify(beklenen) + ', bulunan ' + JSON.stringify(bulunan) + ')');
}
function sapla(rel, exp) {
  const tam = require.resolve(path.join(API, rel));
  const m = new Module(tam, null); m.filename = tam; m.loaded = true; m.exports = exp; require.cache[tam] = m;
}

/* ---------------- Sahte PostgREST ---------------- */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const TABLOLAR = {
  cl_user_prefs: [], cl_assistant_messages: [], cl_deletion_certificates: [],
  scan_jobs: [], cl_scans: [], scan_logs: [], cl_subscriptions: [], cl_device_tokens: [],
  verified_domains: [], monitor_alerts: [], cl_waitlist: [], fix_orders: []
};
let siraNo = 0;

function filtreler(params) {
  const f = [];
  params.forEach(function (v, k) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].indexOf(k) !== -1) return;
    const i = v.indexOf('.');
    f.push({ alan: k, op: v.slice(0, i), deger: v.slice(i + 1) });
  });
  return f;
}
function uyar(satir, f) {
  return f.every(function (x) {
    const s = satir[x.alan];
    if (x.op === 'eq') return String(s) === x.deger;
    if (x.op === 'lte') return Number(s) <= Number(x.deger);
    throw new Error('desteklenmeyen op ' + x.op);
  });
}
function sec(satir, select) {
  if (!select || select === '*') return Object.assign({}, satir);
  const o = {};
  select.split(',').forEach(function (a) { o[a] = satir[a]; });
  return o;
}

async function postgrest(adres, secenek) {
  const u = new URL(adres);
  const tablo = u.pathname.replace('/rest/v1/', '');
  if (!TABLOLAR[tablo]) return { ok: false, status: 404, text: async () => 'yok', json: async () => null };
  const rows = TABLOLAR[tablo];
  const p = u.searchParams;
  const f = filtreler(p);
  const yontem = secenek.method || 'GET';
  const govde = secenek.body ? JSON.parse(secenek.body) : null;
  const tercih = (secenek.headers && secenek.headers.Prefer) || '';
  const cevap = function (veri, durum) {
    return { ok: true, status: durum || 200, json: async () => veri, text: async () => JSON.stringify(veri) };
  };

  if (yontem === 'GET') {
    let liste = rows.filter(function (r) { return uyar(r, f); });
    const order = p.get('order');
    if (order) {
      const parcalar = order.split(',').map(function (o) { const [a, y] = o.split('.'); return { a: a, y: y }; });
      liste.sort(function (x, y) {
        for (const o of parcalar) {
          const d = (x[o.a] < y[o.a] ? -1 : x[o.a] > y[o.a] ? 1 : 0) * (o.y === 'desc' ? -1 : 1);
          if (d) return d;
        }
        return 0;
      });
    }
    const off = Number(p.get('offset') || 0);
    const lim = p.get('limit') ? Number(p.get('limit')) : liste.length;
    liste = liste.slice(off, off + lim);
    return cevap(liste.map(function (r) { return sec(r, p.get('select')); }));
  }
  if (yontem === 'POST') {
    const yeni = Array.isArray(govde) ? govde : [govde];
    yeni.forEach(function (g) {
      if (tablo === 'cl_user_prefs' && p.get('on_conflict') === 'user_id') {
        const var_ = rows.find(function (r) { return r.user_id === g.user_id; });
        if (var_) { Object.assign(var_, g); return; }
      }
      if (tablo === 'cl_deletion_certificates' && rows.some(function (r) { return r.code === g.code; })) {
        throw Object.assign(new Error('409'), { durum: 409 });
      }
      siraNo += 1;
      rows.push(Object.assign({ id: siraNo, created_at: new Date(Date.now() + siraNo).toISOString() }, g));
    });
    return cevap(null, tercih.indexOf('return=minimal') !== -1 ? 201 : 201);
  }
  if (yontem === 'DELETE') {
    const silinen = rows.filter(function (r) { return uyar(r, f); });
    TABLOLAR[tablo] = rows.filter(function (r) { return !uyar(r, f); });
    if (tercih.indexOf('return=representation') !== -1) return cevap(silinen.map(function (r) { return sec(r, p.get('select')); }));
    return { ok: true, status: 204, json: async () => null, text: async () => '' };
  }
  if (yontem === 'PATCH') {
    const eslesen = rows.filter(function (r) { return uyar(r, f); });
    eslesen.forEach(function (r) { Object.assign(r, govde); });
    return cevap(eslesen.map(function (r) { return sec(r, p.get('select')); }));
  }
  throw new Error('yöntem ' + yontem);
}

/* ---------------- Sahte DeepSeek ---------------- */

const saglayiciyaGiden = [];
function sse(metin) {
  const enc = new TextEncoder();
  const parcalar = [
    'data: ' + JSON.stringify({ choices: [{ delta: { content: metin } }] }) + '\n\n',
    'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'
  ];
  let i = 0;
  return new ReadableStream({ pull(c) { if (i < parcalar.length) c.enqueue(enc.encode(parcalar[i++])); else c.close(); } });
}

process.env.SUPABASE_URL = 'https://sahte.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'servis-rolu-sahte';
process.env.AI_ASSISTANT_ENABLED = 'true';
process.env.DEEPSEEK_API_KEY = 'sk-deepseek-test-key-0123456789abcdef';

global.fetch = async function (adres, secenek) {
  if (adres.indexOf('sahte.supabase.co') !== -1) {
    try { return await postgrest(adres, secenek || {}); } catch (e) {
      if (e.durum) return { ok: false, status: e.durum, text: async () => '', json: async () => null };
      throw e;
    }
  }
  if (adres.indexOf('deepseek') !== -1) {
    saglayiciyaGiden.push(JSON.parse(secenek.body));
    return { ok: true, status: 200, body: sse('Tamam, yardımcı olayım.') };
  }
  throw new Error('beklenmeyen istek ' + adres);
};

/* ---------------- Kimlik, depo, Telegram ---------------- */

let oturum = null;          // { id, email } ya da null
let adminSilinen = [];
sapla('_lib/auth.js', {
  isConfigured: function () { return true; },
  adminConfigured: function () { return true; },
  resolveUser: async function () { return oturum ? { id: oturum.id, email: oturum.email, accessToken: 't' } : null; },
  adminDeleteUser: async function (id) { adminSilinen.push(id); return { ok: true, status: 200 }; },
  clearSessionCookies: function () {}
});
sapla('_lib/store.js', {
  isConfigured: function () { return true; },
  hitRateLimit: async function () { return { count: 1, ttl: 60 }; },
  reserveQuota: async function () { return { ok: true, used: 1 }; },
  refundQuota: async function () {}, setOnce: async function () { return true; }
});
const gercekTg = require(path.join(API, '_lib', 'telegram.js'));
sapla('_lib/telegram.js', Object.assign({}, gercekTg, {
  sendTelegram: async function () { return { ok: true }; }, tekSefer: async function () { return true; }
}));

const memory = require(path.join(API, '_lib', 'memory.js'));
const ucMemory = require(path.join(API, 'user', 'memory.js'));
const ucDelete = require(path.join(API, 'user', 'delete.js'));
const ucCert = require(path.join(API, 'deletion-certificate.js'));
const ucAccount = require(path.join(API, 'panel', 'account.js'));
const ucAi = require(path.join(API, 'assistant-ai.js'));

function cevap() {
  const d = {};
  const res = {
    statusCode: 200, body: null, headers: {}, yazilan: '', headersSent: false, writableEnded: false,
    setHeader: function (k, v) { res.headers[k] = v; },
    status: function (c) { res.statusCode = c; return res; },
    json: function (b) { res.body = b; res.writableEnded = true; return res; },
    write: function (s) { res.yazilan += s; }, end: function () { res.writableEnded = true; },
    flushHeaders: function () {}, on: function (a, fn) { d[a] = fn; }
  };
  return res;
}
async function cagir(uc, req) { const res = cevap(); await uc(Object.assign({ headers: {}, query: {} }, req), res); return res; }
async function sor(mesaj) {
  return cagir(ucAi, {
    method: 'POST',
    headers: { origin: 'https://www.cyberlionai.com', 'x-real-ip': '198.51.100.7' },
    body: { message: mesaj, consent: ucAi.CONSENT_VERSION, lang: 'tr' }
  });
}
function sonIstek() { return saglayiciyaGiden[saglayiciyaGiden.length - 1]; }

async function main() {
  /* ================= memory.js ================= */
  esit('karar yokken null', await memory.getRemember(A), null);
  await memory.setRemember(A, true);
  esit('hatırla kaydedildi', await memory.getRemember(A), true);
  await memory.setRemember(A, true);
  esit('upsert çift satır açmaz', TABLOLAR.cl_user_prefs.filter(function (r) { return r.user_id === A; }).length, 1);

  await memory.appendMessages(A, [{ role: 'user', content: 'mailim ali@ornek.com' }, { role: 'system', content: 'x' }]);
  esit('system rolü yazılmaz, metin maskeli', TABLOLAR.cl_assistant_messages.map(function (r) { return [r.role, r.content]; }),
    [['user', 'mailim [e-posta]']]);

  const FAZLA = memory.KEEP + 20;
  const yuz20 = [];
  for (let i = 0; i < FAZLA; i += 1) yuz20.push({ role: i % 2 ? 'assistant' : 'user', content: 'm' + i });
  await memory.appendMessages(A, yuz20);
  const aMesajlari = TABLOLAR.cl_assistant_messages.filter(function (r) { return r.user_id === A; });
  esit('kullanıcı başına KEEP budaması', aMesajlari.length, memory.KEEP);
  dogru('en yeniler kalır', aMesajlari.some(function (r) { return r.content === 'm' + (FAZLA - 1); }) && !aMesajlari.some(function (r) { return r.content === 'm0'; }));
  const son3 = await memory.loadMessages(A, 3);
  esit('yükleme eskiden yeniye, son n', son3.map(function (m) { return m.content; }),
    ['m' + (FAZLA - 3), 'm' + (FAZLA - 2), 'm' + (FAZLA - 1)]);
  dogru('yüklenen mesajda kimlik ve tarih var', typeof son3[0].id === 'number' && typeof son3[0].createdAt === 'string');

  await memory.setRemember(A, false);
  esit('unut beni: konuşmalar silinir', await memory.hasMessages(A), false);
  esit('unut beni kaydedildi', await memory.getRemember(A), false);

  const kod = await memory.createCertificate(['conversations', 'bilinmeyen'], { cl_assistant_messages: 4, kotu: 'x', 'A-B': 2 });
  dogru('sertifika biçimi', memory.CODE_RE.test(kod));
  const satir = TABLOLAR.cl_deletion_certificates.find(function (r) { return r.code === kod; });
  esit('sertifika kapsamı süzülür', satir.scopes, ['conversations']);
  esit('sertifika sayıları süzülür', satir.counts, { cl_assistant_messages: 4 });
  esit('sertifikada kişi alanı yok', Object.keys(satir).sort(), ['code', 'counts', 'created_at', 'id', 'scopes']);
  esit('geçersiz kod sorgulanmaz', await memory.getCertificate('DEL-0000000I'), null);
  let firlatti = null;
  try { await memory.getRemember('1 or 1=1'); } catch (e) { firlatti = e.message; }
  esit('UUID olmayan kimlik reddedilir', firlatti, 'invalid_user_id');

  /* ================= /api/user/memory ================= */
  oturum = null;
  let r = await cagir(ucMemory, { method: 'GET' });
  esit('anonim GET', r.body, { authenticated: false, remember: null, hasMemory: false, greeting: null });
  r = await cagir(ucMemory, { method: 'PUT', body: { remember: true } });
  esit('anonim PUT 401', r.statusCode, 401);

  oturum = { id: B, email: 'b@ornek.com' };
  r = await cagir(ucMemory, { method: 'GET' });
  esit('B: karar yok, ilk kez', r.body, { authenticated: true, remember: null, hasMemory: false, greeting: 'first_time' });
  r = await cagir(ucMemory, { method: 'PUT', body: { remember: 'evet' } });
  esit('boolean olmayan 400', r.statusCode, 400);
  r = await cagir(ucMemory, { method: 'PUT', body: { remember: true } });
  esit('B hatırla', r.body, { remember: true, deleted: 0 });

  /* ================= Hafıza ↔ asistan ================= */
  r = await sor('Sunucum 10.0.0.9, CSP nedir?');
  dogru('ilk soru: model "ilk kez" talimatı alır', sonIstek().messages[0].content.indexOf('first time you are seeing them') !== -1);
  esit('ilk soru: modele eski konuşma gitmez', sonIstek().messages.length, 2);
  dogru('meta memory on', r.yazilan.indexOf('"memory":"on"') !== -1);
  const bMesajlari = TABLOLAR.cl_assistant_messages.filter(function (x) { return x.user_id === B; });
  esit('soru + cevap kaydedildi (maskeli)', bMesajlari.map(function (x) { return x.content; }),
    ['Sunucum [ip], CSP nedir?', 'Tamam, yardımcı olayım.']);

  r = await cagir(ucMemory, { method: 'GET' });
  esit('B geri döndü', [r.body.hasMemory, r.body.greeting], [true, 'returning']);

  await sor('Peki HSTS?');
  dogru('ikinci soru: model hafıza talimatı alır', sonIstek().messages[0].content.indexOf('previous conversations with you') !== -1);
  esit('ikinci soru: eski konuşma modele gider', sonIstek().messages.slice(1, 3).map(function (m) { return m.content; }),
    ['Sunucum [ip], CSP nedir?', 'Tamam, yardımcı olayım.']);

  /* Yalıtım: A, B'nin hafızasını görmez. */
  oturum = { id: A, email: 'a@ornek.com' };
  r = await cagir(ucMemory, { method: 'GET' });
  esit('A, B hafızasını görmez', [r.body.remember, r.body.hasMemory], [false, false]);
  const onceki = TABLOLAR.cl_assistant_messages.length;
  await sor('A soruyor');
  esit('hatırla kapalıyken yazılmaz', TABLOLAR.cl_assistant_messages.length, onceki);
  r = await cagir(ucDelete, { method: 'POST', body: { scopes: ['conversations'] } });
  esit('A silerken B etkilenmez', TABLOLAR.cl_assistant_messages.filter(function (x) { return x.user_id === B; }).length, 4);

  /* ================= Kısmi silme + "ilk kez görüyorum" ================= */
  oturum = { id: B, email: 'b@ornek.com' };
  r = await cagir(ucDelete, { method: 'POST', body: { scopes: ['konusmalar'] } });
  esit('geçersiz kapsam 400', r.statusCode, 400);
  r = await cagir(ucDelete, { method: 'POST', body: { scopes: ['conversations'] } });
  esit('konuşmalar silindi', [r.statusCode, r.body.deleted], [200, { cl_assistant_messages: 4 }]);
  dogru('sertifika kodu döndü', memory.CODE_RE.test(r.body.certificate));
  const sertifikaB = r.body.certificate;

  r = await cagir(ucMemory, { method: 'GET' });
  esit('silmeden sonra: ilk kez (yeni kullanıcıdan ayırt edilemez)', [r.body.remember, r.body.hasMemory, r.body.greeting], [true, false, 'first_time']);
  await sor('Beni hatırlıyor musun?');
  dogru('silmeden sonra: model "ilk kez görüyorum" talimatı alır', sonIstek().messages[0].content.indexOf('sizi ilk kez görüyorum') !== -1);
  esit('silmeden sonra: modele eski konuşma gitmez', sonIstek().messages.length, 2);
  dogru('silinenleri tanıyan iz yok', JSON.stringify(TABLOLAR.cl_deletion_certificates).indexOf(B) === -1
    && JSON.stringify(TABLOLAR.cl_deletion_certificates).indexOf('b@ornek.com') === -1);

  /* Tarama geçmişi: yalnız kendi satırları; günlük anonimleşir. */
  TABLOLAR.scan_jobs.push({ id: 900, user_id: B }, { id: 901, user_id: A });
  TABLOLAR.cl_scans.push({ id: 902, user_id: B });
  TABLOLAR.scan_logs.push({ id: 903, user_id: B, consent_ip: '198.51.100.7' });
  TABLOLAR.verified_domains.push({ id: 904, user_id: B });
  r = await cagir(ucDelete, { method: 'POST', body: { scopes: ['scans'] } });
  esit('tarama silme sayıları', [r.body.deleted, r.body.anonymized], [{ scan_jobs: 1, cl_scans: 1 }, { scan_logs: 1 }]);
  esit('A taraması kalır', TABLOLAR.scan_jobs.map(function (x) { return x.user_id; }), [A]);
  esit('günlük kişiden koparıldı', TABLOLAR.scan_logs[0].user_id, null);
  esit('doğrulanmış alan adı kalır (kapsam dışı)', TABLOLAR.verified_domains.length, 1);

  oturum = null;
  r = await cagir(ucDelete, { method: 'POST', body: { scopes: ['scans'] } });
  esit('anonim silme 401', r.statusCode, 401);

  /* ================= Sertifika doğrulama ================= */
  r = await cagir(ucCert, { method: 'GET', query: { code: sertifikaB.toLowerCase() } });
  esit('sertifika doğrulanır', [r.statusCode, r.body.valid, r.body.scopes], [200, true, ['conversations']]);
  dogru('doğrulamada kişi bilgisi yok', JSON.stringify(r.body).indexOf(B) === -1);
  r = await cagir(ucCert, { method: 'GET', query: { code: 'DEL-ZZZZZZZZ' } });
  esit('bilinmeyen kod 404', r.statusCode, 404);
  r = await cagir(ucCert, { method: 'GET', query: { code: "DEL-1' OR 1=1" } });
  esit('bozuk kod 400', r.statusCode, 400);

  /* ================= Tüm verilerimi sil (hesap) ================= */
  oturum = { id: B, email: 'b@ornek.com' };
  await memory.appendMessages(B, [{ role: 'user', content: 'tekrar' }]);
  r = await cagir(ucAccount, { method: 'DELETE', body: { confirm: 'HESABIMI SIL' } });
  esit('hesap silindi', r.statusCode, 200);
  dogru('hesap silmede sertifika', memory.CODE_RE.test(r.body.certificate));
  esit('hafıza ve tercih silindi (silmeden sonraki 2 + 1 mesaj)', [r.body.deleted.cl_assistant_messages, r.body.deleted.cl_user_prefs], [3, 1]);
  dogru('B için satır kalmadı', ['cl_user_prefs', 'cl_assistant_messages', 'scan_jobs', 'cl_scans', 'verified_domains']
    .every(function (t) { return !TABLOLAR[t].some(function (x) { return x.user_id === B; }); }));
  esit('auth satırı en sonda silindi', adminSilinen, [B]);

  if (hatalar.length) {
    console.error('BAŞARISIZ (' + hatalar.length + '):\n  - ' + hatalar.join('\n  - '));
    process.exit(1);
  }
  console.log('memory: ' + gecti + ' doğrulama geçti');
}

main().catch(function (e) { console.error(e); process.exit(1); });
