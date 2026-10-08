'use strict';
/**
 * Alt motor sınaması (api/_lib/engines/*). Ağ yok.
 *
 * Motorlara bölme bir YENİDEN DÜZENLEME idi: kontrol mantığı, sırası ve skoru
 * değişmemeliydi. tools/engines-golden-fixture.js 400 rastgele (sabit tohumlu)
 * başlık/TLS/DNS/HTML birleşimiyle buildChecks + scoreOf çıktısı üretir; o
 * çıktının özeti bölmeden ÖNCEKİ koddan alındı. Özet değişirse bir motorun
 * davranışı değişmiş demektir: bilinçliyse özeti güncelleyin ve nedenini yazın.
 */
const crypto = require('node:crypto');
const path = require('node:path');
let gecti = 0; const hatalar = [];
function esit(ad, b, e) { if (b === e) { gecti += 1; return; } hatalar.push(ad + ' (beklenen ' + JSON.stringify(e) + ', bulunan ' + JSON.stringify(b) + ')'); }
function dogru(ad, k) { if (k) { gecti += 1; return; } hatalar.push(ad); }

const ONCEKI_OZET = 'fe97a1185dc5da8c5dc98ca977db3a3299264f238d0b29ba7d127ad3404657fb';
const cikti = require('./engines-golden-fixture.js');
esit('400 durumda çıktı bölmeden önceki kodla birebir', crypto.createHash('sha256').update(cikti).digest('hex'), ONCEKI_OZET);

const sc = require(path.join(__dirname, '..', 'api', '_lib', 'scanner.js'));
esit('kontrol sırası', sc.ORDER.join(','),
  'https,hsts,csp,xframe,nosniff,referrer,permissions,cookies,disclosure,mixed_content,coop,coep,corp,cors,sri,tls_protocol,tls_cert,tls_legacy,spf,dmarc,dkim,dnssec,blacklist');

const E = path.join(__dirname, '..', 'api', '_lib', 'engines');
['header-scanner', 'cookie-scanner', 'tls-scanner', 'dns-scanner', 'blacklist-scanner'].forEach(function (n) {
  const m = require(path.join(E, n + '.js'));
  const r = m.analyze({ headers: { get: function () { return null; }, getSetCookie: function () { return []; } },
    finalUrl: new URL('https://ornek.com/'), html: null, tls: null, legacyTls: null, mail: null }, 'tr');
  dogru(n + ' { checks, findings, fixCode } döndürür', Array.isArray(r.checks) && Array.isArray(r.findings) && r.fixCode && typeof r.fixCode === 'object');
});

const hdr = require(path.join(E, 'header-scanner.js')).analyze({
  headers: { get: function () { return null; }, getSetCookie: function () { return []; } },
  finalUrl: new URL('https://ornek.com/'), html: null }, 'en');
dogru('kalan HSTS için Nginx kodu', /add_header Strict-Transport-Security/.test(hdr.fixCode.hsts.nginx));
dogru('fixCode dile göre (EN Cloudflare)', /In the Cloudflare dashboard/.test(hdr.fixCode.hsts.cloudflare));
esit('geçen kontrolde fixCode yok', hdr.fixCode.https, undefined);

const bl = require(path.join(E, 'blacklist-scanner.js'));
const set = bl.parseHostfile('127.0.0.1\tkotu.example\n');
esit('kara liste: alt alan yakalanır', bl.analyze({ finalUrl: new URL('https://cdn.kotu.example/'), blacklist: set }).checks[0].status, 'fail');
esit('kara liste: indirilemedi → skipped', bl.analyze({ finalUrl: new URL('https://a.com/'), blacklist: null }).checks[0].status, 'skipped');
esit('kara liste: sorulmadı → kontrol yok', bl.analyze({ finalUrl: new URL('https://a.com/') }).checks.length, 0);
esit('kara liste: ağırlık info (skoru kaydırmaz)', bl.analyze({ finalUrl: new URL('https://kotu.example/'), blacklist: set }).checks[0].severity, 'info');

if (hatalar.length) { console.error('Motor sınaması: ' + hatalar.length + ' KALDI'); hatalar.forEach(function (h) { console.error('  ✗ ' + h); }); process.exit(1); }
console.log('Motor sınaması: ' + gecti + ' / ' + gecti + ' geçti');
