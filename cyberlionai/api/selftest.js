'use strict';

/**
 * GEÇİCİ doğrulama ucu.
 *
 * Tarama motorunun üretim ortamında (yalnızca yerelde değil) gerçekten
 * çalıştığını kanıtlamak için eklendi: sunucusuz fonksiyondan dışa TCP/TLS
 * bağlantısı açılabiliyor mu, süre bütçesi yetiyor mu.
 *
 * Kötüye kullanılamaz: hedef sabit bir listeden seçilir, kullanıcı adres
 * veremez. Doğrulama tamamlandıktan sonra bu dosya kaldırılacaktır.
 */

const { scanSite } = require('./_lib/scanner.js');

const ALLOWED = ['example.com', 'github.com', 'vercel.com'];

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const host = (req.query && req.query.host) || 'example.com';
  if (ALLOWED.indexOf(host) === -1) {
    return res.status(400).json({ error: 'host_not_allowed', allowed: ALLOWED });
  }

  const started = Date.now();
  try {
    const result = await scanSite(host);
    return res.status(200).json({
      ok: true,
      runtime: { node: process.version, region: process.env.VERCEL_REGION || null },
      target: result.url,
      httpStatus: result.httpStatus,
      score: result.score,
      summary: result.summary,
      warnings: result.warnings,
      tls: result.checks.filter(function (c) { return c.id.indexOf('tls') === 0; })
                        .map(function (c) { return c.id + '=' + c.status + (c.detail ? '(' + c.detail + ')' : ''); }),
      durationMs: Date.now() - started
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      runtime: { node: process.version, region: process.env.VERCEL_REGION || null },
      code: (err && err.message) || 'unknown',
      durationMs: Date.now() - started
    });
  }
};
