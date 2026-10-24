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

/* OpenSSL hata kodundan SEBEP. Önceki davranış kodu notun kendisi olarak
   geçiriyordu; sözlükte karşılığı olmadığı için müşteri raporunda
   "UNABLE_TO_VERIFY_LEAF_SIGNATURE" gibi ham bir dize görünüyordu. Her sebebin
   düzeltmesi FARKLI olduğu için ayrım yalnızca çeviri meselesi değil:
   eksik ara sertifikanın çözümü yenileme değil, zinciri tam göndermektir.

   Eşleme ölçümle yazıldı (koşu 38167648017):
     incomplete-chain.badssl.com → UNABLE_TO_VERIFY_LEAF_SIGNATURE, zincir 1
     expired.badssl.com          → CERT_HAS_EXPIRED, zincir 3
   Diğer kodlar OpenSSL'in X509 doğrulama hata adlarıdır. */
const SEBEP = {
  CERT_HAS_EXPIRED: 'expired',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'chain_incomplete',
  UNABLE_TO_GET_ISSUER_CERT: 'chain_incomplete',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'chain_incomplete',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'self_signed',
  SELF_SIGNED_CERT_IN_CHAIN: 'self_signed',
  ERR_TLS_CERT_ALTNAME_INVALID: 'hostname_mismatch',
  CERT_REVOKED: 'revoked'
};

function certSebebi(t) {
  const kod = t.authorizationError ? String(t.authorizationError) : '';
  const bilinen = SEBEP[kod];
  if (bilinen) return bilinen;
  /* Kod tanınmadı: zincirin tek halkadan oluşması ara sertifikanın hiç
     gönderilmediğini gösteriyor. Ölçülmüş bir gösterge, tahmin değil. */
  if (t.chainLength === 1) return 'chain_incomplete';
  /* Son çare: eskiden olduğu gibi "doğrulanamadı" — ama artık ham OpenSSL
     kodu DEĞİL, çevirisi olan bir not. */
  return 'untrusted';
}

/* Kalan süre metni. Eskiden `daysLeft + ' gün'` yazılıyordu: süresi dolmuş
   sertifikada rapor "-4213 gün" gösteriyordu. Dil de sabit Türkçeydi. */
function gunMetni(gun, lang) {
  if (lang === 'en') return gun < 0 ? 'expired ' + (-gun) + ' days ago' : gun + ' days left';
  return gun < 0 ? (-gun) + ' gün önce doldu' : gun + ' gün kaldı';
}

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
    if (!t.authorized) { certStatus = 'fail'; certNote = certSebebi(t); }
    else if (t.daysLeft !== null && t.daysLeft < 0) { certStatus = 'fail'; certNote = 'expired'; }
    else if (t.daysLeft !== null && t.daysLeft < 15) { certStatus = 'fail'; certNote = 'expiring_soon'; }
    checks.push(check('tls_cert', 'high', certStatus,
      t.daysLeft !== null ? gunMetni(t.daysLeft, lang) : null,
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

module.exports = { analyze, certSebebi, gunMetni, IDS: ["tls_protocol", "tls_cert", "tls_legacy"] };
