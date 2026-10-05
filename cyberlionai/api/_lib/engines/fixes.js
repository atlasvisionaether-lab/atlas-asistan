'use strict';

/**
 * Bulgu başına düzeltme parçaları ve hizmet fiyat kademesi — TEK KAYNAK.
 *
 * Her kayıt: { tier, nginx, apache, cloudflare, dns }
 *   tier       'header' (₺499) | 'tls_dns' (₺999); bu listede OLMAYAN bulgular
 *              (OWASP A01–A10 vb.) yalnızca 'full' pakette düzeltilir.
 *   nginx/apache  sunucu yapılandırma satırı (yoksa null)
 *   cloudflare    Cloudflare panelinde yapılacak işlem (yoksa null)
 *   dns           DNS kaydı (SPF/DMARC/DKIM/DNSSEC için; yoksa null)
 *
 * Başlık değerleri sitedeki "Düzeltme" önerileriyle aynı; arayüz bu parçaları
 * /api/fix-suggestion'dan alıyor (istemcide ayrı kopya yok).
 */

const HEADER_VALUES = {
  hsts: ['Strict-Transport-Security', 'max-age=63072000; includeSubDomains'],
  csp: ['Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'self'"],
  xframe: ['X-Frame-Options', 'DENY'],
  nosniff: ['X-Content-Type-Options', 'nosniff'],
  referrer: ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  permissions: ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
  coop: ['Cross-Origin-Opener-Policy', 'same-origin'],
  coep: ['Cross-Origin-Embedder-Policy', 'require-corp'],
  corp: ['Cross-Origin-Resource-Policy', 'same-origin']
};

const CF_HEADER = {
  tr: 'Cloudflare panelinde: Rules › Transform Rules › Modify Response Header › Set static\nBaşlık: {name}\nDeğer: {value}',
  en: 'In the Cloudflare dashboard: Rules › Transform Rules › Modify Response Header › Set static\nHeader: {name}\nValue: {value}'
};

function headerFix(id, tier) {
  const hv = HEADER_VALUES[id];
  return function (lang) {
    return {
      tier: tier,
      nginx: 'add_header ' + hv[0] + ' "' + hv[1].replace(/"/g, '\\"') + '" always;',
      apache: 'Header always set ' + hv[0] + ' "' + hv[1].replace(/"/g, '\\"') + '"',
      cloudflare: CF_HEADER[lang].replace('{name}', hv[0]).replace('{value}', hv[1]),
      dns: null
    };
  };
}

const CSP_WARN = {
  tr: ['ÖNCE TEST ORTAMINDA DENEYİN. Bu politika olduğu gibi canlıya alınırsa satır içi',
       'script/stil, yazı tipi (Google Fonts), analitik ve CDN kaynaklarını engelleyip',
       'sitenizi bozabilir. Önce başlığı Content-Security-Policy-Report-Only adıyla ekleyin,',
       'tarayıcı konsolundaki ihlallere göre politikayı sitenize uyarlayın, sonra',
       'Content-Security-Policy adına geçin.'],
  en: ['TRY IT ON STAGING FIRST. Deployed as-is, this policy can block inline scripts/styles,',
       'fonts (Google Fonts), analytics and CDN resources and break your site. First add the',
       'header as Content-Security-Policy-Report-Only, adapt the policy to your site using the',
       'violations in the browser console, then switch to Content-Security-Policy.']
};

/** CSP: headerFix ile aynı kod, önünde test uyarısı. */
function cspFix(lang) {
  const base = headerFix('csp', 'tls_dns')(lang);
  const comment = CSP_WARN[lang].map(function (l) { return '# ' + l; }).join('\n');
  return {
    tier: base.tier,
    nginx: comment + '\n' + base.nginx,
    apache: comment + '\n' + base.apache,
    cloudflare: CSP_WARN[lang].join(' ') + '\n\n' + base.cloudflare,
    dns: null
  };
}

function fixed(tier, nginx, apache, cf, dns) {
  return function (lang) {
    return { tier: tier, nginx: nginx, apache: apache, cloudflare: cf ? cf[lang] : null, dns: dns ? dns[lang] : null };
  };
}

const FIXES = {
  hsts: headerFix('hsts', 'header'),
  xframe: headerFix('xframe', 'header'),
  nosniff: headerFix('nosniff', 'header'),
  referrer: headerFix('referrer', 'header'),
  permissions: headerFix('permissions', 'header'),
  coop: headerFix('coop', 'header'),
  coep: headerFix('coep', 'header'),
  corp: headerFix('corp', 'header'),
  disclosure: fixed('header', 'server_tokens off;', 'ServerTokens Prod\nServerSignature Off', null, null),
  /* CSP sitenin kendi betiklerinin incelenmesini gerektirir: başlık tek satır
     ama doğru politika siteye özgü. Bu yüzden 'tls_dns' kademesinde.
     Kodun yanında uyarı var: bu değer olduğu gibi canlıya alınırsa satır içi
     script/stil, yazı tipi ve analitiği engeller (1-Tık düzeltme aynı değerle
     atlasasistan.com'u bozdu). Önce Report-Only ile denenmesi öneriliyor. */
  csp: cspFix,
  https: fixed('tls_dns',
    'server {\n  listen 80;\n  server_name _;\n  return 301 https://$host$request_uri;\n}',
    'RewriteEngine On\nRewriteCond %{HTTPS} off\nRewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]',
    { tr: 'Cloudflare panelinde: SSL/TLS › Edge Certificates › Always Use HTTPS: Açık',
      en: 'In the Cloudflare dashboard: SSL/TLS › Edge Certificates › Always Use HTTPS: On' }, null),
  tls_protocol: fixed('tls_dns', 'ssl_protocols TLSv1.2 TLSv1.3;', 'SSLProtocol -all +TLSv1.2 +TLSv1.3',
    { tr: 'Cloudflare panelinde: SSL/TLS › Edge Certificates › Minimum TLS Version: TLS 1.2',
      en: 'In the Cloudflare dashboard: SSL/TLS › Edge Certificates › Minimum TLS Version: TLS 1.2' }, null),
  tls_legacy: fixed('tls_dns', 'ssl_protocols TLSv1.2 TLSv1.3;', 'SSLProtocol -all +TLSv1.2 +TLSv1.3',
    { tr: 'Cloudflare panelinde: SSL/TLS › Edge Certificates › Minimum TLS Version: TLS 1.2',
      en: 'In the Cloudflare dashboard: SSL/TLS › Edge Certificates › Minimum TLS Version: TLS 1.2' }, null),
  tls_cert: fixed('tls_dns', '# certbot renew  (Let\'s Encrypt)\nssl_certificate     /etc/ssl/fullchain.pem;\nssl_certificate_key /etc/ssl/privkey.pem;',
    'SSLCertificateFile    /etc/ssl/fullchain.pem\nSSLCertificateKeyFile /etc/ssl/privkey.pem',
    { tr: 'Cloudflare panelinde: SSL/TLS › Overview › Full (strict); kaynak sunucuya geçerli sertifika (Origin CA) yükleyin.',
      en: 'In the Cloudflare dashboard: SSL/TLS › Overview › Full (strict); install a valid certificate (Origin CA) on the origin.' }, null),
  cookies: fixed('tls_dns', '# nginx 1.19.3+ (ters vekil)\nproxy_cookie_flags ~ secure httponly samesite=lax;',
    'Header always edit Set-Cookie ^(.*)$ "$1; Secure; HttpOnly; SameSite=Lax"', null, null),
  mixed_content: fixed('tls_dns', null, null,
    { tr: 'Cloudflare panelinde: SSL/TLS › Edge Certificates › Automatic HTTPS Rewrites: Açık (kalıcı çözüm: http:// kaynakları https:// yapın).',
      en: 'In the Cloudflare dashboard: SSL/TLS › Edge Certificates › Automatic HTTPS Rewrites: On (lasting fix: change http:// resources to https://).' }, null),
  cors: fixed('tls_dns', 'add_header Access-Control-Allow-Origin "https://izinli-site.com" always;',
    'Header always set Access-Control-Allow-Origin "https://izinli-site.com"', null, null),
  sri: fixed('tls_dns', null, null, null,
    null),
  spf: fixed('tls_dns', null, null, null,
    { tr: 'TXT  @  "v=spf1 include:<posta sağlayıcınız> -all"', en: 'TXT  @  "v=spf1 include:<your mail provider> -all"' }),
  dmarc: fixed('tls_dns', null, null, null,
    { tr: 'TXT  _dmarc  "v=DMARC1; p=quarantine; rua=mailto:dmarc@<alan adınız>"',
      en: 'TXT  _dmarc  "v=DMARC1; p=quarantine; rua=mailto:dmarc@<your domain>"' }),
  dkim: fixed('tls_dns', null, null, null,
    { tr: 'TXT  <seçici>._domainkey  "<posta sağlayıcınızın verdiği DKIM anahtarı>"',
      en: 'TXT  <selector>._domainkey  "<DKIM key from your mail provider>"' }),
  dnssec: fixed('tls_dns', null, null,
    { tr: 'Cloudflare panelinde: DNS › Settings › DNSSEC › Enable; verilen DS kaydını alan adı kayıt firmanıza ekleyin.',
      en: 'In the Cloudflare dashboard: DNS › Settings › DNSSEC › Enable; add the DS record it gives you at your registrar.' }, null)
};

/* Kontrollerin önem derecesi (motorlardaki check() çağrılarıyla aynı). */
const SEVERITY = {
  https: 'critical', csp: 'critical', hsts: 'high', cookies: 'high', mixed_content: 'high',
  tls_protocol: 'high', tls_cert: 'high', tls_legacy: 'high', xframe: 'medium', nosniff: 'medium',
  referrer: 'low', permissions: 'low', disclosure: 'low', sri: 'low',
  coop: 'info', coep: 'info', corp: 'info', cors: 'info', spf: 'info', dmarc: 'info', dkim: 'info', dnssec: 'info'
};

/** Bir bulgunun düzeltmesi; listede yoksa null (yalnızca tam pakette). */
function fixFor(id, lang) {
  const f = FIXES[id];
  return f ? f(lang === 'en' ? 'en' : 'tr') : null;
}

/** Kalan kontrollerin düzeltme parçaları: { id: {nginx, apache, cloudflare, dns, tier} } */
function fixCodeFor(checks, lang) {
  const out = {};
  (checks || []).forEach(function (c) {
    if (c.status !== 'fail') return;
    const f = fixFor(c.id, lang);
    if (f) out[c.id] = f;
  });
  return out;
}

module.exports = { FIXES, SEVERITY, fixFor, fixCodeFor, HEADER_VALUES };
