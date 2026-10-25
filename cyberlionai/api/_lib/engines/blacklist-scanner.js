'use strict';

/**
 * Kara liste motoru: taranan adres Google Web Risk listelerinde mi
 * (zararlı yazılım, oltalama, istenmeyen yazılım).
 *
 * Kaynak: Google Web Risk Lookup API (bkz. _lib/webrisk.js). Önceki kaynak
 * abuse.ch URLhaus'un toplu listeleri 410 Gone dönüyordu: kontrol canlıda
 * her taramada "ölçülemedi" oluyordu (ölçüldü: 2026-10-24).
 *
 * Ağırlık 'info' (0): ana skor web yapılandırmasını ölçüyor; kara listede
 * olmak ayrı ve ciddi bir sinyal, rapor ve izleme uyarısında öne çıkıyor.
 * Kullanıcıya gösterilen metin "olası" dilini ve Google atfını taşır
 * (Web Risk kullanım koşulları; metinler report.js / index.html'de).
 *
 * @returns {{ checks, findings, fixCode }}
 */

const { check } = require('./common.js');

/**
 * context.blacklist: webrisk.lookup sonucu ({ ok, threats, expireTime } ya
 * da { ok:false, reason }) | null (sorgu düştü) | undefined (hiç sorulmadı —
 * kontrol eklenmez; kalibrasyon sınaması bu yoldan geçer).
 */
function analyze(context) {
  const checks = [];
  const r = context.blacklist;
  if (r === undefined) return { checks: checks, findings: [], fixCode: {} };

  if (!r || !r.ok) {
    const note = r && r.reason === 'not_configured' ? 'not_configured' : 'not_measured';
    checks.push(check('blacklist', 'info', 'skipped', null, { note: note }));
  } else if (r.threats && r.threats.length) {
    /* Ayrıntıda ham tür kodu (MALWARE…) YOK: müşteriye görünen metin; türler
       `threats` alanında, arayüz kendi diliyle yazar. */
    checks.push(check('blacklist', 'info', 'fail', 'Google Web Risk',
      { note: 'webrisk_match', threats: r.threats.slice(), expireTime: r.expireTime || null }));
  } else {
    checks.push(check('blacklist', 'info', 'pass', 'Google Web Risk'));
  }
  return { checks: checks, findings: [], fixCode: {} };
}

module.exports = { analyze, IDS: ['blacklist'] };
