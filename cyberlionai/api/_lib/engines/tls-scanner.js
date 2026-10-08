'use strict';

/**
 * TLS motoru: protokol sürümü, sertifika geçerliliği, eski TLS (1.0/1.1) kabulü. Ağ ölçümü scanner.js'te (inspectTls/probeLegacyTls); bu motor sonucu yorumlar.
 *
 * scanner.js'in buildChecks'inden TAŞINDI; kontrol mantığı, sırası ve
 * ağırlıkları değişmedi (tools/engines-test.js eski çıktıyla birebir
 * karşılaştırır). Saf: ağ yok, bağlamdan okur.
 *
 * @returns { checks: Array, findings: Array, fixCode: Object }
 */

const { check, parseMaxAge, getSetCookies } = require('./common.js');
const { fixCodeFor } = require('./fixes.js');

function analyze(context, lang) {
  const h = context.headers;
  const checks = [];
  const isHttps = context.finalUrl.protocol === 'https:';

  /* --- TLS --- */
  const t = context.tls;
  if (!isHttps || !t || !t.ok) {
    checks.push(check('tls_protocol', 'high', 'skipped', t && t.reason ? t.reason : null, { note: 'not_measured' }));
    checks.push(check('tls_cert', 'high', 'skipped', null, { note: 'not_measured' }));
  } else {
    const modern = t.protocol === 'TLSv1.3' || t.protocol === 'TLSv1.2';
    checks.push(check('tls_protocol', 'high', modern ? 'pass' : 'fail', t.protocol));

    let certStatus = 'pass';
    let certNote = null;
    if (!t.authorized) { certStatus = 'fail'; certNote = t.authorizationError || 'untrusted'; }
    else if (t.daysLeft !== null && t.daysLeft < 0) { certStatus = 'fail'; certNote = 'expired'; }
    else if (t.daysLeft !== null && t.daysLeft < 15) { certStatus = 'fail'; certNote = 'expiring_soon'; }
    checks.push(check('tls_cert', 'high', certStatus,
      t.daysLeft !== null ? t.daysLeft + ' gün' : null,
      { note: certNote, issuer: t.issuer }));
  }

  /* --- Eski TLS sürümleri --- */
  const legacy = context.legacyTls;
  if (!isHttps || !legacy || !legacy.tested) {
    checks.push(check('tls_legacy', 'high', 'skipped', legacy && legacy.reason ? legacy.reason : null,
      { note: 'not_measured' }));
  } else {
    checks.push(check('tls_legacy', 'high', legacy.accepted ? 'fail' : 'pass',
      legacy.accepted ? 'TLS 1.0/1.1 kabul ediliyor' : 'Yalnızca modern TLS'));
  }

  return { checks: checks, findings: [], fixCode: fixCodeFor(checks, lang) };
}

module.exports = { analyze, IDS: ["tls_protocol", "tls_cert", "tls_legacy"] };
