'use strict';

/**
 * Tarama seviyeleri — hangi işlem hangi yetkiyi ister. TEK KAYNAK.
 *
 *   1 PASSIVE       Herkes, doğrulama yok. Sıradan bir tarayıcının yaptığı
 *                   okumalar: TLS el sıkışması, yanıt başlıkları, çerez
 *                   bayrakları, DNS'teki SPF/DMARC/DKIM kayıtları.
 *   2 INTRUSIVE     Doğrulanmış alan adı ZORUNLU. Sitenin normal kullanımında
 *                   olmayan istekler: XSS/SQLi yoklaması (zararsız yük) ve
 *                   hassas dosya yolu denemesi (/.env, /.git/HEAD …).
 *   3 MODIFICATION  Doğrulanmış alan adı + kullanıcının KENDİ Cloudflare
 *                   belirteci ZORUNLU. Hedefin yapılandırmasını değiştirir.
 *
 * Neden yol denemesi 2. seviyede: /.env istemek başlık okumaktan farklı; site
 * sahibinin yayınlamadığı bir yolu tahmin etmek. Tek istek bile olsa,
 * izinsiz yapıldığında "dizin taraması" olarak görülür.
 *
 * Onay kutusu (consent) artık TEK BAŞINA yetmez: beyandır, kanıt değildir.
 * Aktif testler ancak beyan + doğrulanmış sahiplik birlikteyse çalışır.
 */

const PASSIVE = 1;
const INTRUSIVE = 2;
const MODIFICATION = 3;

const NAMES = { 1: 'passive', 2: 'intrusive', 3: 'modification' };

/** İstekten gelen seviye adını sayıya çevirir; tanınmayan değer pasif. */
function parseLevel(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'intrusive' || v === '2') return INTRUSIVE;
  if (v === 'modification' || v === '3') return MODIFICATION;
  return PASSIVE;
}

/**
 * Aktif testler çalışabilir mi: kullanıcı beyan etti (onay kutusu) VE alan
 * adı bu hesap için doğrulanmış.
 */
function activeAllowed(consent, verified) {
  return consent === true && verified === true;
}

/** Fiilen uygulanan seviye (günlük için). */
function effectiveLevel(consent, verified) {
  return activeAllowed(consent, verified) ? INTRUSIVE : PASSIVE;
}

function verifyUrl(domain) {
  return '/verify?domain=' + encodeURIComponent(domain || '');
}

/** 403 gövdesi: doğrulama gerekiyor. */
function ownershipRequired(domain, lang) {
  return {
    error: {
      code: 'ownership_required',
      verifyUrl: verifyUrl(domain),
      message: lang === 'en'
        ? 'This domain is not verified for the account you are signed in with. Verify it at cyberlionai.com/verify (DNS TXT, file or meta tag), or sign in with the account that verified it. Required for active tests and changes (Turkish Penal Code arts. 243/244).'
        : 'Bu alan adı giriş yaptığınız hesapta doğrulanmamış. cyberlionai.com/verify adresinden doğrulayın (DNS TXT, dosya ya da meta etiketi) veya alan adını doğrulamış hesapla giriş yapın. Aktif testler ve değişiklikler için zorunludur (TCK m.243/244).'
    }
  };
}

module.exports = {
  PASSIVE, INTRUSIVE, MODIFICATION, NAMES,
  parseLevel, activeAllowed, effectiveLevel, verifyUrl, ownershipRequired
};
