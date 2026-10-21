'use strict';

/**
 * Asistan hafızası ve "unutulma hakkı" veri katmanı (bkz. db/migrations/011).
 *
 *   getRemember(userId)              → true | false | null (karar verilmedi)
 *   setRemember(userId, bool)        → false ise kayıtlı konuşmalar da silinir
 *   loadMessages(userId, n)          → son n mesaj, eskiden yeniye ({ id, role, content, createdAt })
 *   searchMessages(userId, vec, k, beforeId) → anlamca en yakın k mesaj (012, pgvector)
 *   hasMessages(userId)              → boolean
 *   appendMessages(userId, list)     → ekler (ops. vektörüyle), kullanıcı başına KEEP'e budar
 *   deleteMessages(userId)           → silinen satır sayısı
 *   createCertificate(scopes, counts)→ "DEL-XXXXXXXX"
 *   getCertificate(code)             → { code, scopes, counts, createdAt } | null
 *
 * KURALLAR
 *   - Kimlik HER ZAMAN çağıranın doğruladığı oturumdan gelir; bu modül
 *     yalnızca UUID biçimini denetler.
 *   - İçerik buraya gelmeden önce `ai-redact` ile maskelenmiş olmalı
 *     (çağıran uç bunu yapar; burada ikinci kez maskelenir — emniyet kemeri).
 *   - Sertifikada kişiye bağ YOK: user_id, e-posta, IP yazılmaz. "Silineni
 *     tanımak" için iz tutulmaz; geri gelen kullanıcı yeni kullanıcıdır.
 */

const crypto = require('node:crypto');
const db = require('./db.js');
const { redact } = require('./ai-redact.js');
const { toPg, DIM } = require('./embed.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* Kullanıcı başına saklanan en fazla mesaj. 012 ile anlamsal arama TÜM bu
   geçmişte yapılıyor; 1000 satırda tam (exact) vektör araması hızlı. */
const KEEP = 1000;
const MAX_CONTENT = 4000;    // tablo kısıtıyla aynı
const SCOPES = ['conversations', 'scans', 'account'];
/* Crockford base32: 0/O, 1/I/L, U karışmasın diye çıkarılmış harfler. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_RE = /^DEL-[0-9A-HJKMNP-TV-Z]{8}$/;

function uid(userId) {
  const s = String(userId || '');
  if (!UUID_RE.test(s)) throw new Error('invalid_user_id');
  return encodeURIComponent(s);
}

function isConfigured() { return db.isConfigured(); }

async function getRemember(userId) {
  const rows = await db.request('cl_user_prefs?user_id=eq.' + uid(userId) + '&select=remember_me&limit=1');
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows[0].remember_me === true;
}

async function setRemember(userId, remember) {
  const value = remember === true;
  await db.request('cl_user_prefs?on_conflict=user_id', {
    method: 'POST',
    body: { user_id: decodeURIComponent(uid(userId)), remember_me: value, updated_at: new Date().toISOString() },
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' }
  });
  /* "Hayır, unut beni": karar anında kayıtlı konuşmalar da gider. */
  const deleted = value ? 0 : await deleteMessages(userId);
  return { remember: value, deleted: deleted };
}

async function loadMessages(userId, n) {
  const limit = Math.max(1, Math.min(Number(n) || 12, 50));
  const rows = await db.request('cl_assistant_messages?user_id=eq.' + uid(userId)
    + '&select=id,role,content,created_at&order=created_at.desc,id.desc&limit=' + limit);
  return Array.isArray(rows) ? rows.reverse().map(function (r) {
    return { id: r.id, role: r.role, content: r.content, createdAt: r.created_at };
  }) : [];
}

/**
 * Anlamsal arama (db/migrations/012). `beforeId` verilirse ondan yeni
 * mesajlar hariç: onlar zaten "son mesajlar" olarak bağlamda.
 * Dönüş eskiden yeniye sıralı: modele kronolojik gitsin.
 */
async function searchMessages(userId, vector, k, beforeId) {
  if (!Array.isArray(vector) || vector.length !== DIM) throw new Error('invalid_vector');
  const rows = await db.request('rpc/cl_match_assistant_messages', {
    method: 'POST',
    body: {
      p_user_id: decodeURIComponent(uid(userId)),
      p_query: toPg(vector),
      p_limit: Math.max(1, Math.min(Number(k) || 5, 20)),
      p_before_id: Number.isInteger(beforeId) ? beforeId : null
    }
  });
  if (!Array.isArray(rows)) return [];
  return rows.map(function (r) {
    return { id: r.id, role: r.role, content: r.content, createdAt: r.created_at, similarity: r.similarity };
  }).sort(function (a, b) { return a.id - b.id; });
}

async function hasMessages(userId) {
  const rows = await db.request('cl_assistant_messages?user_id=eq.' + uid(userId) + '&select=id&limit=1');
  return Array.isArray(rows) && rows.length > 0;
}

async function appendMessages(userId, list) {
  const id = decodeURIComponent(uid(userId));
  const valid = (list || []).filter(function (m) {
    return m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim();
  });
  /* PostgREST toplu eklemede TÜM nesnelerin anahtarları aynı olmalı; biri
     vektörlü biri vektörsüzse ikisi de reddedilirdi (inceleme bulgusu).
     Hiçbirinde vektör yoksa sütun hiç gönderilmez: 012 uygulanmamış bir
     veritabanında da yazma çalışır. */
  const vectorOk = function (m) { return Array.isArray(m.embedding) && m.embedding.length === DIM; };
  const withVectors = valid.some(vectorOk);
  const rows = valid.map(function (m) {
    const row = { user_id: id, role: m.role, content: redact(m.content.trim()).text.slice(0, MAX_CONTENT) };
    /* Vektör yoksa satır yine yazılır; yalnızca anlamsal aramada görünmez. */
    if (withVectors) row.embedding = vectorOk(m) ? toPg(m.embedding) : null;
    return row;
  });
  if (!rows.length) return 0;
  await db.request('cl_assistant_messages', {
    method: 'POST', body: rows, headers: { 'Prefer': 'return=minimal' }
  });

  /* Budama: KEEP'inci en yeni mesajdan eskiler silinir. */
  const cut = await db.request('cl_assistant_messages?user_id=eq.' + uid(userId)
    + '&select=id&order=id.desc&offset=' + KEEP + '&limit=1');
  if (Array.isArray(cut) && cut.length) {
    await db.request('cl_assistant_messages?user_id=eq.' + uid(userId) + '&id=lte.' + Number(cut[0].id), {
      method: 'DELETE', headers: { 'Prefer': 'return=minimal' }
    });
  }
  return rows.length;
}

async function deleteMessages(userId) {
  const rows = await db.request('cl_assistant_messages?user_id=eq.' + uid(userId) + '&select=id', {
    method: 'DELETE', headers: { 'Prefer': 'return=representation' }
  });
  return Array.isArray(rows) ? rows.length : 0;
}

function newCode() {
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i += 1) s += ALPHABET[bytes[i] % 32];
  return 'DEL-' + s;
}

/** Sayılar yalnızca tablo adı → tam sayı; başka hiçbir şey sertifikaya girmez. */
function cleanCounts(counts) {
  const out = {};
  Object.keys(counts || {}).forEach(function (k) {
    const v = counts[k];
    if (/^[a-z_]{1,40}$/.test(k) && Number.isInteger(v) && v >= 0) out[k] = v;
  });
  return out;
}

async function createCertificate(scopes, counts) {
  const list = Array.from(new Set((scopes || []).filter(function (s) { return SCOPES.indexOf(s) !== -1; })));
  if (!list.length) throw new Error('invalid_scopes');
  /* Çakışma olasılığı 32^8 ≈ 10^12'de bir; yine de birincil anahtar
     çakışırsa (409) bir kez daha denenir. */
  for (let deneme = 0; deneme < 2; deneme += 1) {
    const code = newCode();
    try {
      await db.request('cl_deletion_certificates', {
        method: 'POST',
        body: { code: code, scopes: list, counts: cleanCounts(counts) },
        headers: { 'Prefer': 'return=minimal' }
      });
      return code;
    } catch (err) {
      if (!/db_error_409/.test(err.message) || deneme === 1) throw err;
    }
  }
  throw new Error('certificate_failed');
}

async function getCertificate(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!CODE_RE.test(c)) return null;
  const rows = await db.request('cl_deletion_certificates?code=eq.' + encodeURIComponent(c)
    + '&select=code,scopes,counts,created_at&limit=1');
  if (!Array.isArray(rows) || !rows.length) return null;
  const r = rows[0];
  return { code: r.code, scopes: r.scopes, counts: r.counts || {}, createdAt: r.created_at };
}

module.exports = {
  isConfigured, getRemember, setRemember, loadMessages, searchMessages, hasMessages, appendMessages,
  deleteMessages, createCertificate, getCertificate, newCode, cleanCounts,
  KEEP, SCOPES, CODE_RE
};
