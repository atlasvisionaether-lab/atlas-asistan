'use strict';

/**
 * Başlık motoru: HTTPS, HSTS, CSP, X-Frame, nosniff, Referrer, Permissions, bilgi ifşası, karışık içerik, COOP/COEP/CORP, CORS, SRI.
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

  /* --- Aktarım güvenliği --- */
  checks.push(check('https', 'critical', isHttps ? 'pass' : 'fail',
    isHttps ? context.finalUrl.origin : 'HTTP: ' + context.finalUrl.origin));

  const hsts = h.get('strict-transport-security');
  const hstsAge = parseMaxAge(hsts);
  checks.push(check('hsts', 'high',
    hsts && hstsAge && hstsAge >= 15552000 ? 'pass' : 'fail',
    hsts || null,
    { note: hsts && (!hstsAge || hstsAge < 15552000) ? 'max_age_low' : null }));

  /* --- İçerik güvenliği başlıkları --- */
  const csp = h.get('content-security-policy');
  let cspStatus = 'fail';
  let cspNote = null;
  if (csp) {
    const scriptSrc = /script-src[^;]*/i.exec(csp);
    const source = scriptSrc ? scriptSrc[0] : csp;
    if (/'unsafe-inline'/i.test(source) && !/'(nonce-|sha256-)/i.test(source)) {
      cspStatus = 'fail';
      cspNote = 'unsafe_inline';
    } else {
      cspStatus = 'pass';
    }
  }
  checks.push(check('csp', 'critical', cspStatus, csp ? csp.slice(0, 300) : null, { note: cspNote }));

  const xfo = h.get('x-frame-options');
  const frameAncestors = csp && /frame-ancestors/i.test(csp);
  checks.push(check('xframe', 'medium', xfo || frameAncestors ? 'pass' : 'fail',
    xfo || (frameAncestors ? 'CSP: frame-ancestors' : null)));

  const nosniff = h.get('x-content-type-options');
  checks.push(check('nosniff', 'medium',
    nosniff && /nosniff/i.test(nosniff) ? 'pass' : 'fail', nosniff));

  const referrer = h.get('referrer-policy');
  checks.push(check('referrer', 'low', referrer ? 'pass' : 'fail', referrer));

  const permissions = h.get('permissions-policy') || h.get('feature-policy');
  checks.push(check('permissions', 'low', permissions ? 'pass' : 'fail',
    permissions ? permissions.slice(0, 200) : null));

  /* --- Bilgi ifşası --- */
  const server = h.get('server');
  const powered = h.get('x-powered-by');
  const disclosed = [server, powered].filter(Boolean);
  const versioned = disclosed.some(function (v) { return /\d+\.\d+/.test(v); });
  checks.push(check('disclosure', 'low', versioned ? 'fail' : 'pass',
    disclosed.length ? disclosed.join(' | ') : null));

  /* --- Karışık içerik (yalnızca HTTPS sayfalarda anlamlı) --- */
  if (!isHttps) {
    checks.push(check('mixed_content', 'high', 'skipped', null, { note: 'not_https' }));
  } else if (context.html === null) {
    checks.push(check('mixed_content', 'high', 'skipped', null, { note: 'no_html' }));
  } else {
    const matches = context.html.match(/(?:src|href)\s*=\s*["']http:\/\/[^"']+/gi) || [];
    const insecure = matches.filter(function (m) { return !/http:\/\/(localhost|127\.)/i.test(m); });
    checks.push(check('mixed_content', 'high', insecure.length ? 'fail' : 'pass',
      insecure.length ? insecure.length + ' kaynak' : null,
      { samples: insecure.slice(0, 3).map(function (m) { return m.replace(/^[^=]*=\s*["']/, '').slice(0, 120); }) }));
  }

  /* --- Çapraz köken sertleştirmesi ---------------------------------------
     ÖLÇÜLDÜ (koşu 34663226505): Observatory bu başlıkların YOKLUĞUNU
     başarısızlık saymıyor —

       coop-not-implemented  pass=true   m=0
       coep-not-implemented  pass=true   m=0
       corp-not-implemented  pass=null   m=0

     Bu doğru bir duruş: bunlar derinlemesine savunma katmanları, kusur değil.
     Yoklukta "fail" versek hem hemen her siteyle çelişirdik hem de haksız
     olurduk. O yüzden: yoksa `skipped`, varsa ve BİLEREK zayıflatılmışsa
     `fail`. Ağırlık `info` (0) — mevcut müşterilerin skoru bu eklemeyle
     kaymıyor; bunlar tavsiye, ceza değil. */

  const coop = (h.get('cross-origin-opener-policy') || '').trim().toLowerCase();
  if (!coop) {
    checks.push(check('coop', 'info', 'skipped', null, { note: 'not_implemented' }));
  } else {
    /* `unsafe-none` tarayıcı varsayılanı ama BİLEREK yazılmışsa korumayı
       kapatma niyetidir; onu ayrıca işaretliyoruz. */
    checks.push(check('coop', 'info', coop === 'unsafe-none' ? 'fail' : 'pass', coop));
  }

  const coep = (h.get('cross-origin-embedder-policy') || '').trim().toLowerCase();
  if (!coep) {
    checks.push(check('coep', 'info', 'skipped', null, { note: 'not_implemented' }));
  } else {
    checks.push(check('coep', 'info', coep === 'unsafe-none' ? 'fail' : 'pass', coep));
  }

  const corp = (h.get('cross-origin-resource-policy') || '').trim().toLowerCase();
  if (!corp) {
    checks.push(check('corp', 'info', 'skipped', null, { note: 'not_implemented' }));
  } else {
    const gecerli = corp === 'same-origin' || corp === 'same-site' || corp === 'cross-origin';
    checks.push(check('corp', 'info', gecerli ? 'pass' : 'fail', corp));
  }

  /* CORS: `*` tek başına kusur DEĞİL — herkese açık bir API için doğru
     olabilir; Observatory de m=0 veriyor. Gerçek sorun `*` ile birlikte
     kimlik bilgisi istenmesi: tarayıcı bu ikiliyi zaten reddeder, yani
     yapılandırma yanlış yazılmış demektir. Bunu ayrıca işaretliyoruz ve
     bu, Observatory'den BİLEREK ayrıldığımız tek nokta. */
  const acao = (h.get('access-control-allow-origin') || '').trim();
  const acac = (h.get('access-control-allow-credentials') || '').trim().toLowerCase();
  if (!acao) {
    checks.push(check('cors', 'info', 'skipped', null, { note: 'not_implemented' }));
  } else if (acao === '*' && acac === 'true') {
    /* Onem derecesi CIKTIYA gore degismemeli — kalibrasyon sinamasi bunu
       yakaladi ve hakliydi. Bu grubun tamami `info`: tarayici zaten bu
       ikiliyi reddediyor, yani somurulebilir bir acik degil, yanlis yazilmis
       bir yapilandirma. Raporda basarisiz kontrol olarak gorunuyor ama skoru
       kaydirmiyor. */
    checks.push(check('cors', 'info', 'fail', acao + ' + credentials',
      { note: 'wildcard_with_credentials' }));
  } else {
    checks.push(check('cors', 'info', 'pass', acao.slice(0, 120)));
  }

  /* SRI: yalnızca BAŞKA bir kökenden yüklenen script'ler için anlamlıdır.
     Kendi kökeninden yüklenen dosyada bütünlük özniteliği beklenmez —
     Observatory de öyle yapıyor (sri-not-implemented-but-no-scripts-loaded
     ve ...-all-scripts-loaded-from-secure-origin, ikisi de pass=null). */
  if (context.html === null) {
    checks.push(check('sri', 'low', 'skipped', null, { note: 'no_html' }));
  } else {
    const scriptler = context.html.match(/<script\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*>/gi) || [];
    const disKokenli = scriptler.filter(function (etiket) {
      const m = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(etiket);
      if (!m) return false;
      let u;
      try { u = new URL(m[1], context.finalUrl); } catch (e) { return false; }
      return u.origin !== context.finalUrl.origin;
    });
    const butunluksuz = disKokenli.filter(function (etiket) {
      return !/\bintegrity\s*=\s*["'][^"']+["']/i.test(etiket);
    });
    if (!disKokenli.length) {
      checks.push(check('sri', 'low', 'skipped', null, { note: 'no_external_scripts' }));
    } else {
      checks.push(check('sri', 'low', butunluksuz.length ? 'fail' : 'pass',
        butunluksuz.length ? butunluksuz.length + '/' + disKokenli.length + ' script'
                           : disKokenli.length + ' script',
        { samples: butunluksuz.slice(0, 3).map(function (e) {
            const m = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(e);
            return m ? m[1].slice(0, 120) : '';
          }) }));
    }
  }

  return { checks: checks, findings: [], fixCode: fixCodeFor(checks, lang) };
}

module.exports = { analyze, IDS: ["https", "hsts", "csp", "xframe", "nosniff", "referrer", "permissions", "disclosure", "mixed_content", "coop", "coep", "corp", "cors", "sri"] };
