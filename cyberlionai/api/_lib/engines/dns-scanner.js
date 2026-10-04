'use strict';

/**
 * DNS / e-posta motoru: SPF, DMARC, DKIM, DNSSEC.
 *
 * scanner.js'in buildChecks'inden TAŞINDI; kontrol mantığı, sırası ve
 * ağırlıkları değişmedi (tools/engines-test.js eski çıktıyla birebir
 * karşılaştırır). Saf: ağ yok, bağlamdan okur.
 *
 * @returns { checks: Array, findings: Array, fixCode: Object }
 */

const { check, parseMaxAge, getSetCookies } = require('./common.js');
const { fixCodeFor } = require('./fixes.js');
const mail = require('../mail');

function analyze(context, lang) {
  const h = context.headers;
  const checks = [];
  const isHttps = context.finalUrl.protocol === 'https:';

  /* --- E-posta kimlik doğrulaması (SPF / DMARC / DKIM) --------------------
     Ağırlık `info` (0): bu üçü POSTA yüzeyini ölçüyor, skor ise WEB yüzeyi
     için kalibre edilmiş. Ağırlık vermek, hiçbir şeyini değiştirmemiş
     müşterilerin skorunu bir gecede düşürürdü. Bulgu olarak görünüyorlar,
     düzeltmesi raporda yazıyor, skor sabit kalıyor. Ayrıntılı gerekçe:
     _lib/mail.js başlığı. */
  const m = context.mail;

  if (!m || !m.ok) {
    /* Sebep saklanmıyor: alan adı yoksa "SPF yok" demek yanlış olur, sorgu
       düştüyse de bilmiyoruz demektir. İkisi de ölçüm başarısızlığı. */
    const sebep = (m && m.sebep) || 'not_measured';
    ['spf', 'dmarc', 'dkim'].forEach(function (id) {
      checks.push(check(id, 'info', 'skipped', null, { note: sebep }));
    });
  } else {
    const spf = mail.spfDegerlendir(m.spf);
    if (spf.durum === 'none') {
      /* Yokluk BURADA başarısızlıktır ve bu, COOP/COEP'ten bilinçli bir
         ayrım: orada yokluk zararsız bir eksik katmandı, burada yokluk
         "herkes bu alan adı adına e-posta gönderebilir" demek. Üstelik
         yokluğu ÖLÇTÜK (NOERROR/NODATA), varsayımda bulunmuyoruz. */
      checks.push(check('spf', 'info', 'fail', null, { note: 'spf_missing' }));
    } else {
      checks.push(check('spf', 'info', spf.durum, spf.detay || null,
        spf.not ? { note: spf.not } : null));
    }

    const dmarc = mail.dmarcDegerlendir(m.dmarc);
    if (dmarc.durum === 'none') {
      checks.push(check('dmarc', 'info', 'fail', null, { note: 'dmarc_missing' }));
    } else {
      checks.push(check('dmarc', 'info', dmarc.durum, dmarc.detay || null,
        dmarc.not ? { note: dmarc.not } : null));
    }

    /* DKIM ASLA `fail` olmuyor. Bir alan adının seçicileri DNS'ten
       numaralandırılamaz (ölçüldü); bulamamak "yok" demek değil, "bilmiyoruz"
       demektir. Yokluğu başarısızlık saymak, ölçmediğimiz bir şeyi
       cezalandırmak olurdu. */
    if (m.dkimJoker) {
      checks.push(check('dkim', 'info', 'skipped', null, { note: 'dkim_wildcard' }));
    } else if (m.dkimSecici) {
      checks.push(check('dkim', 'info', 'pass', m.dkimSecici + '._domainkey'));
    } else {
      checks.push(check('dkim', 'info', 'skipped', null, { note: 'dkim_not_enumerable' }));
    }
  }

  /* DNSSEC (bkz. _lib/dnssec.js). Bağlamda yoksa kontrol hiç eklenmez:
     kalibrasyon sınaması buildChecks'i DNSSEC'siz çağırıyor. */
  const ds = context.dnssec;
  if (ds) {
    checks.push(ds.ok
      ? check('dnssec', 'info', ds.enabled ? 'pass' : 'fail', ds.zone || null)
      : check('dnssec', 'info', 'skipped', null, { note: ds.reason || 'not_measured' }));
  }

  return { checks: checks, findings: [], fixCode: fixCodeFor(checks, lang) };
}

module.exports = { analyze, IDS: ["spf", "dmarc", "dkim", "dnssec"] };
