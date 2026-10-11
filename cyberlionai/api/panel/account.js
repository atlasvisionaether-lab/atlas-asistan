'use strict';

/**
 * Hesabı ve hesaba bağlı TÜM veriyi silme ucu.
 *
 *   DELETE /api/panel/account   { "confirm": "HESABIMI SIL" }
 *
 * NEDEN VAR
 *
 * Google Play, hesap açtıran bir uygulamanın hem uygulama içinden hem de
 * HERKESE AÇIK BİR WEB ADRESİNDEN hesap ve veri silmeyi sunmasını şart
 * koşuyor; KVKK'nın silme talebi de aynı şeyi istiyor. Bugüne kadar silme
 * yolu YOKTU: `/api/history` yalnızca tarama kayıtlarını siliyordu, hesabın
 * kendisi ve abonelik/jeton/bekleme listesi satırları kalıyordu.
 *
 * NE SİLİNİYOR (karar: "her şeyi sil")
 *
 *   scan_jobs (+ scan_findings, ai_reports — cascade)
 *   cl_scans · cl_subscriptions · cl_device_tokens
 *   verified_domains · monitor_alerts · cl_waitlist (e-posta ile)
 *   ve en sonda Supabase `auth.users` satırı
 *
 * İKİ İSTİSNA, İKİSİ DE GEREKÇELİ
 *
 *   scan_logs  Üçüncü bir siteyi kimin taradığını gösteren hukuki ispat
 *              günlüğü. Satır kalıyor, `user_id` NULL'a çekiliyor: kayıt
 *              duruyor ama kişiye bağlı değil.
 *   iyzico     Fatura ve vergi yükümlülüğü olan ödeme kayıtları iyzico
 *              tarafında; bizde kart verisi hiç yok, yalnızca referans
 *              tutuluyordu ve o referans bu uçta siliniyor.
 *
 * SIRA: VERİ ÖNCE, HESAP SONRA
 *
 * Tersi olsaydı `auth.users` silinince `scan_jobs.user_id` NULL'a düşer
 * (kısıt `on delete set null`) ve satırlar SAHİPSİZ kalırdı — artık hangi
 * hesaba ait olduğunu bilmediğimiz için silinemez hâle gelirlerdi. Veri
 * silinip hesap silinemezse kullanıcı tekrar deneyebilir; tersi geri
 * alınamaz.
 *
 * YETKİ: oturum ZORUNLU ve yalnızca KENDİ hesabı. Silinecek kimlik istek
 * gövdesinden DEĞİL, çözülen oturumdan geliyor; gövdede kimlik alanı yok.
 */

const db = require('../_lib/db.js');
const auth = require('../_lib/auth.js');
const tg = require('../_lib/telegram.js');

/* Kazara silmeye karşı açık onay. Panelin onay kutusu ve /hesap-silme sayfası
   bu dizgeyi gönderiyor; TR ve EN sayfalar aynı uca gittiği için iki karşılık
   da kabul ediliyor. Parmak kayması ya da bir otomatik araç tek başına
   DELETE atsa bile hesap gitmez. */
const ONAY = ['HESABIMI SIL', 'HESABIMI SİL', 'DELETE MY ACCOUNT'];

function onayVar(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const deger = body && typeof body.confirm === 'string' ? body.confirm.trim().toUpperCase() : '';
  return ONAY.indexOf(deger) !== -1;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  /* Servis rolü anahtarı olmadan hesap satırı silinemez. Yarısı yapılabilen
     bir silme sunmaktan iyisi, hiç başlamamak. */
  if (!db.isConfigured() || !auth.isConfigured() || !auth.adminConfigured()) {
    return res.status(503).json({ error: { code: 'account_delete_unavailable' } });
  }

  const user = await auth.resolveUser(req, res, { bearerKabul: true });
  if (!user) return res.status(401).json({ error: { code: 'auth_required' } });

  if (!onayVar(req)) {
    return res.status(400).json({ error: { code: 'confirmation_required' } });
  }

  let sonuc;
  try {
    sonuc = await db.deleteAccountData(user.id, user.email);
  } catch (err) {
    if (console && console.error) console.error('account delete data failed:', err.message);
    return res.status(503).json({ error: { code: 'account_delete_failed' } });
  }

  let hesap;
  try {
    hesap = await auth.adminDeleteUser(user.id);
  } catch (err) {
    if (console && console.error) console.error('account delete user failed:', err.message);
    hesap = { ok: false, status: 0 };
  }

  if (!hesap.ok) {
    /* Veri gitti, hesap satırı kaldı. Kullanıcıya doğru olanı söylüyoruz:
       tekrar denemesi yeterli, ikinci deneme veri tarafında 0 satır bulur. */
    return res.status(503).json({
      error: { code: 'account_delete_partial' },
      deleted: sonuc.silinen,
      anonymized: sonuc.anonimlestirilen,
      skipped: sonuc.atlanan
    });
  }

  /* Oturum çerezleri temizlenir: hesap artık yok, elde kalan token'la
     dolaşmasın. */
  auth.clearSessionCookies(res);

  /* Denetim izi. E-posta MASKELİ gider; silinen satır sayıları gider,
     silinen verinin KENDİSİ gitmez. */
  try {
    await tg.sendTelegram(tg.mesaj.hesapSilindi(user.email, sonuc.silinen), { type: 'alert' });
  } catch (e) { /* bildirim gönderilemedi diye silme geri alınmaz */ }

  return res.status(200).json({
    ok: true,
    deleted: sonuc.silinen,
    anonymized: sonuc.anonimlestirilen,
    skipped: sonuc.atlanan
  });
};
