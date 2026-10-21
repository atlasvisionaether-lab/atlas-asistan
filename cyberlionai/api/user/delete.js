'use strict';

/**
 * Kısmi veri silme ("Veri Yönetimi" paneli).
 *
 *   POST /api/user/delete  { scopes: ['conversations'] | ['scans'] | ['conversations','scans'] }
 *     → { ok, certificate: 'DEL-XXXXXXXX' | null, mail, deleted, anonymized, skipped }
 *        mail: 'sent' | 'unconfigured' | 'failed' | 'no_code' — sertifika
 *              e-postası; gönderilemezse sertifika yine yanıtta (ekranda)
 *
 *   conversations  cl_assistant_messages (asistan hafızası). Hafıza tercihi
 *                  KALIR: kullanıcı "hatırla" demeye devam ediyorsa yeni
 *                  konuşmalar yeniden birikir; kapatmak için PUT /api/user/memory.
 *   scans          scan_jobs (+ bulgular, AI raporları) ve cl_scans.
 *                  scan_logs SİLİNMEZ, kişiye bağı kesilir (hukuki ispat
 *                  günlüğü; hesap silmedeki gerekçenin aynısı).
 *
 * "Tüm verilerimi sil" bu uçta DEĞİL: hesabın kendisi de gittiği için
 * DELETE /api/panel/account (onay dizgesi şart) kullanılır; o uç da sertifika
 * üretir.
 *
 * Sertifika: kod + kapsam + silinen satır sayıları. Kullanıcı kimliği,
 * e-posta, IP YAZILMAZ (bkz. db/migrations/011).
 */

const auth = require('../_lib/auth.js');
const db = require('../_lib/db.js');
const memory = require('../_lib/memory.js');
const mailer = require('../_lib/mailer.js');

const ALLOWED = ['conversations', 'scans'];

function bodyOf(req) {
  const b = req && req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string' && b) { try { return JSON.parse(b); } catch (e) { return null; } }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }
  if (!db.isConfigured() || !auth.isConfigured()) {
    return res.status(503).json({ error: { code: 'delete_unavailable' } });
  }

  const user = await auth.resolveUser(req, res);
  if (!user) return res.status(401).json({ error: { code: 'auth_required' } });

  const body = bodyOf(req);
  const scopes = body && Array.isArray(body.scopes) ? Array.from(new Set(body.scopes)) : [];
  if (!scopes.length || scopes.some(function (s) { return ALLOWED.indexOf(s) === -1; })) {
    return res.status(400).json({ error: { code: 'invalid_scopes', allowed: ALLOWED } });
  }

  const deleted = {};
  const anonymized = {};
  const skipped = [];
  try {
    if (scopes.indexOf('conversations') !== -1) {
      deleted.cl_assistant_messages = await memory.deleteMessages(user.id);
    }
    if (scopes.indexOf('scans') !== -1) {
      const r = await db.deleteScanHistory(user.id);
      Object.assign(deleted, r.silinen);
      Object.assign(anonymized, r.anonimlestirilen);
      skipped.push.apply(skipped, r.atlanan);
    }
  } catch (err) {
    if (console && console.error) console.error('partial delete failed:', err.message);
    return res.status(503).json({ error: { code: 'delete_failed' }, deleted: deleted });
  }

  /* Sertifika yazılamazsa silme geri alınmaz; kullanıcıya kodsuz başarı
     döner ve bu durum açıkça işaretlenir. */
  let certificate = null;
  try {
    certificate = await memory.createCertificate(scopes, deleted);
  } catch (err) {
    if (console && console.error) console.error('certificate failed:', err.message);
  }

  /* Sertifika e-postası hesabın kendi adresine. Gönderilemezse silme
     başarılı kalır; arayüz "e-posta gönderilemedi, sertifika ekranda" der. */
  let mail = 'failed';
  try { mail = user.email ? await mailer.sendCertificate(user.email, certificate, scopes) : 'failed'; } catch (e) { mail = 'failed'; }

  return res.status(200).json({
    ok: true, certificate: certificate, mail: mail, deleted: deleted, anonymized: anonymized, skipped: skipped
  });
};
