'use strict';

/**
 * İsteğin HAM gövdesi (Buffer). Meta imzası (X-Hub-Signature-256) ham baytlar
 * üzerinden hesaplanır; ayrıştırılıp yeniden yazılan JSON imzayı tutmaz.
 *
 * Sıra: req.rawBody (varsa) → akış henüz okunmadıysa akıştan → req.body
 * metin/Buffer ise o. req.body yalnız nesne olarak kaldıysa (ham hâli kayıp)
 * yeniden yazılmış JSON döner ve imza büyük olasılıkla tutmaz — bilerek
 * "geçerli" sayılmaz.
 */

const MAX_BYTES = 1024 * 1024;

async function readRaw(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (req.readable && typeof req.on === 'function' && !req.readableEnded) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BYTES) throw Object.assign(new Error('body_too_large'), { status: 413 });
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    }
    if (chunks.length) return Buffer.concat(chunks);
  }
  const b = req.body;
  if (Buffer.isBuffer(b)) return b;
  if (typeof b === 'string') return Buffer.from(b, 'utf8');
  if (b && typeof b === 'object') return Buffer.from(JSON.stringify(b), 'utf8');
  return Buffer.alloc(0);
}

module.exports = { readRaw, MAX_BYTES };
