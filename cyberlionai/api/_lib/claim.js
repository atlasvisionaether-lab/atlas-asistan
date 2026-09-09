'use strict';

/**
 * Anonim geçmişin hesaba devri.
 *
 * Kullanıcı kaydolduğunda veya giriş yaptığında, aynı tarayıcıdaki anonim
 * oturumun tarama kayıtları hesabına taşınır. Devir yalnızca **isteğin kendi
 * doğrulanmış `cl_sid` çerezindeki** oturum için yapılır; istemci hangi
 * oturumun devralınacağını söyleyemez.
 *
 * Sıra önemli: önce veritabanı, sonra kota.
 *   1. UPDATE gerçekte kaç satır taşıdığını döndürür.
 *   2. Kota tam o kadar artırılır.
 * Aynı akış tekrar çalışırsa UPDATE 0 satır bulur ve kota da artmaz. Ters
 * sırada olsaydı, kota artıp devir başarısız olduğunda kullanıcı hakkını
 * boş yere kaybederdi.
 *
 * Devir başarısız olursa kayıtlar anonim oturumda kalır: veri kaybı olmaz,
 * kullanıcı çıkış yapınca geçmişini yine görür. Bu yüzden hata yukarı
 * fırlatılmaz — giriş işlemi devir yüzünden başarısız sayılmamalı.
 */

const db = require('./db.js');
const store = require('./store.js');
const { FREE_SCAN_LIMIT, QUOTA_TTL_SECONDS } = require('./limits.js');

/**
 * @returns {{ claimed: number, quotaUsed: number|null, error: string|null }}
 */
async function claimForUser(sessionId, userId) {
  const result = { claimed: 0, quotaUsed: null, error: null };

  if (!sessionId || !userId) return result;
  if (!db.isConfigured()) return result;

  let moved = 0;
  try {
    moved = await db.claimAnonymousScans(sessionId, userId);
  } catch (err) {
    if (console && console.error) console.error('claim failed:', err.message);
    result.error = 'claim_failed';
    return result;
  }
  result.claimed = moved;

  if (!store.isConfigured()) return result;

  const key = store.quotaKey({ userId: userId });
  try {
    result.quotaUsed = moved > 0
      ? await store.addToQuota(key, moved, FREE_SCAN_LIMIT, QUOTA_TTL_SECONDS)
      : await store.readQuota(key);
  } catch (err) {
    // Kayıtlar taşındı ama sayaç güncellenemedi. Kullanıcı lehine bir hata:
    // bir sonraki taramada sayaç yine okunur, veri kaybı yok.
    if (console && console.error) console.error('quota transfer failed:', err.message);
    result.error = 'quota_transfer_failed';
  }

  return result;
}

module.exports = { claimForUser };
