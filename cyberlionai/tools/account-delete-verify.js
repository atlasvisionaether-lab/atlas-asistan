'use strict';

/**
 * Hesap silme doğrulaması — doğrudan Supabase Admin ile, HTTP uç YOK.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... CONFIRM=evet \
 *     node cyberlionai/tools/account-delete-verify.js
 *
 * NEDEN BÖYLE
 *
 * Önceki sürüm silme ucunu https://www.cyberlionai.com üzerinden çağırıyordu;
 * Vercel yönlendirmesi, alan adı ya da koruma bayrağından gelebilecek 404
 * betiğin ölçümünü blokluyordu. Bu sürüm hiçbir genel uç ağa çıkmıyor:
 * hesabı da silme iş mantığını da doğrudan Supabase'ten yönetiyor.
 *
 * Silme iş mantığı uğradırılmıyor: api/panel/account.js'in kullandığı
 * db.deleteAccountData (cyberlionai/api/_lib/db.js) birebir import ediliyor.
 * Yani burada ölçülen şey, uçta çalışan kodun AYNISI.
 *
 * ÖLÇMEDIĞI ŞEY (bilinçli): DELETE /api/panel/account ucunun HTTP kapıları
 * (oturum zorunluluğu, onay dizgesi). Uç tarafın davranışı
 * tools/account-delete-test.js ve uç kodunun kendisi kapsamında kalıyor;
 * bu betik verinin ve hesabın GERÇEKTEN silindiğini ölçer.
 *
 * ÜRETİM VERİTABANINA YAZAR. CONFIRM=evet olmadan hiçbir şey yapmaz.
 * Açtığı hesap ve yazdığı satırlar finally temizliğinde KALMAZ.
 *
 * E-posta öneki hep 'kaldir-test+': bu önek YALNIZCA bu betik tarafından
 * açılır; üretimde yanlışlıkla gerçek kullanıcı silinmediği çıktıdan
 * okunabilsin. Koşunun başında aynı önekle açılmış eski artıklar da
 * temizlenir: önceki başarısız koşulardan sızan test hesabı kalmaz.
 */

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const db = require('../api/_lib/db.js');

const URL_SB = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CONFIRM = process.env.CONFIRM || '';

const KALIN = '\x1b[1m';
const YESIL = '\x1b[32m';
const KIRMIZI = '\x1b[31m';
const SIFIRLA = '\x1b[0m';

let gecti = 0;
let kalan = 0;
function sonuc(ok, ad, ek) {
  if (ok) { gecti++; process.stdout.write('  ' + YESIL + 'GEÇTİ' + SIFIRLA + '  ' + ad + (ek ? ' — ' + ek : '') + '\n'); }
  else { kalan++; process.stdout.write('  ' + KIRMIZI + 'KALDI' + SIFIRLA + '  ' + ad + (ek ? ' — ' + ek : '') + '\n'); }
}

/** PostgREST "tablo yok" hatası mı (göç uygulanmamış)? */
function tabloYok(error) {
  const m = String((error && (error.message || (error.error && error.error.message))) || error || '');
  return /PGRST205|does not exist|Could not find the table|schema cache/i.test(m);
}

(async function () {
  process.stdout.write(KALIN + 'Hesap silme doğrulaması — doğrudan Supabase admin (HTTP uç yok)' + SIFIRLA + '\n');
  process.stdout.write('Zaman : ' + new Date().toISOString() + '\n\n');

  if (!URL_SB || !KEY) {
    process.stdout.write('ÖLÇÜLEMEDİ — SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli.\n');
    process.stdout.write('Anahtarlar GitHub Actions gizli değişkenlerinden gelir; sohbete yazılmaz.\n');
    process.exit(2);
  }

  if (CONFIRM !== 'evet') {
    process.stdout.write('ONAY YOK — hiçbir şey yapılmadı.\n\n');
    process.stdout.write('Bu betik ÜRETİM veritabanına yazar ve siler:\n');
    process.stdout.write('  1. kaldir-test+<zaman>@cyberlionai.com adında test hesabı açar\n');
    process.stdout.write('  2. o hesaba ait cl_scans / cl_device_tokens / cl_waitlist / scan_logs satırı yazar\n');
    process.stdout.write('  3. GERÇEK silme iş mantığını çağırır (db.deleteAccountData + admin.deleteUser)\n');
    process.stdout.write('  4. satırların gittiğini, scan_logs bağı kesildiğini, hesabın kapandığını okur\n');
    process.stdout.write('  5. ne olursa olsun artığı temizler\n\n');
    process.stdout.write('Gerçek kullanıcılara DOKUNMAZ: tüm sorgular test hesabıyla sınırlı.\n');
    process.exit(1);
  }

  const supabase = createClient(URL_SB, KEY, { auth: { persistSession: false } });

  /* ---------- 0. Önceki başarısız koşulardan sızan test artıkları ------
     Bu önek yalnızca bu betik tarafından açılır; eşleşen her hesap bu
     testindir. Erken çıkan koşular hesabı silmeden bırakabilir — burada
     toplanıp kapatılıyor ki üretimde test artığı kalmasın. */
  try {
    const eskiArtik = [];
    for (let sayfa = 1; sayfa <= 5; sayfa++) {
      const { data: liste } = await supabase.auth.admin.listUsers({ page: sayfa, perPage: 1000 });
      const kullanicilar = (liste && liste.users) || [];
      for (const u of kullanicilar) {
        if (u && typeof u.email === 'string' && u.email.indexOf('kaldir-test+') === 0) eskiArtik.push(u);
      }
      if (!liste || !liste.users || liste.users.length < 1000) break;
    }
    for (const u of eskiArtik) {
      await supabase.auth.admin.deleteUser(u.id);
      await supabase.from('cl_waitlist').delete().eq('email', u.email);
    }
    if (eskiArtik.length) process.stdout.write('Eski test artığı temizlendi: ' + eskiArtik.length + ' hesap\n');
  } catch (e) {
    process.stdout.write('Eski artık temizliği atlandı: ' + e.message + '\n');
  }

  /* ------------------------------------------------- 1. Test hesabı */
  const testEmail = 'kaldir-test+' + Date.now() + '@cyberlionai.com';
  const sifre = crypto.randomBytes(18).toString('base64url') + 'Aa1!';

  const { data: yaratilan, error: errYarat } = await supabase.auth.admin.createUser({
    email: testEmail,
    password: sifre,
    email_confirm: true,
    user_metadata: { is_test_account: true, purpose: 'account-delete-verify' }
  });
  /* supabase-js v2: admin.createUser'ın data'sı DOĞRUDAN kullanıcıdır
     (v1'deki gibi data.user içinde DEĞİL). İki biçim de destekleniyor. */
  const userId = (yaratilan && (yaratilan.id || (yaratilan.user && yaratilan.user.id))) || null;
  sonuc(!!userId, 'test hesabı açıldı', userId ? testEmail : ('hata: ' + (errYarat && errYarat.message)));
  if (!userId) { process.stdout.write('\nDevam edilemiyor.\n'); process.exit(1); }

  /* Temizlik her yolda çalışsın. */
  async function temizle() {
    const artik = [];
    const restTablolar = [
      ['cl_scans', 'user_id', userId],
      ['cl_device_tokens', 'user_id', userId],
      ['cl_subscriptions', 'user_id', userId],
      ['verified_domains', 'user_id', userId],
      ['monitor_alerts', 'user_id', userId],
      ['scan_jobs', 'user_id', userId]
    ];
    for (const [tablo, kolon, deger] of restTablolar) {
      const { data } = await supabase.from(tablo).delete().eq(kolon, deger).select('id');
      if (data && data.length) artik.push(tablo + '=' + data.length);
    }
    const wl = await supabase.from('cl_waitlist').delete().eq('email', testEmail).select('id');
    if (wl.data && wl.data.length) artik.push('cl_waitlist=' + wl.data.length);
    const sl = await supabase.from('scan_logs').delete().eq('user_id', userId).select('id');
    if (sl.data && sl.data.length) artik.push('scan_logs=' + sl.data.length);
    const { error: errUser } = await supabase.auth.admin.deleteUser(userId);
    if (!errUser) artik.push('auth.users=1');
    return artik;
  }

  let dogrulandi = false;
  try {
    /* --------------------------------------------- 2. Satır tohumla */
    async function ekle(tablo, satir) {
      const { data, error } = await supabase.from(tablo).insert(satir).select();
      return { ok: !error && data && data.length > 0, id: data && data[0] ? data[0].id : null, error: error };
    }

    const tohum = [];
    const scans = await ekle('cl_scans', { user_id: userId, host: 'example.com', score: 50, checks_total: 1 });
    if (scans.ok) tohum.push('cl_scans');
    else if (!tabloYok(scans.error)) process.stdout.write('  cl_scans yazılamadı: ' + (scans.error && scans.error.message) + '\n');
    const jeton = await ekle('cl_device_tokens', { user_id: userId, token: 'kaldir-test-' + crypto.randomBytes(16).toString('hex'), platform: 'android' });
    if (jeton.ok) tohum.push('cl_device_tokens');
    else if (!tabloYok(jeton.error)) process.stdout.write('  cl_device_tokens yazılamadı: ' + (jeton.error && jeton.error.message) + '\n');
    const bekleme = await ekle('cl_waitlist', { email: testEmail, plan: 'pro', domain: 'example.com' });
    if (bekleme.ok) tohum.push('cl_waitlist');
    else if (!tabloYok(bekleme.error)) process.stdout.write('  cl_waitlist yazılamadı: ' + (bekleme.error && bekleme.error.message) + '\n');
    const gunluk = await ekle('scan_logs', { user_id: userId, domain: 'example.com', level: 'passive', verified: false, consent: false });
    if (gunluk.ok) tohum.push('scan_logs');
    else if (!tabloYok(gunluk.error)) process.stdout.write('  scan_logs yazılamadı: ' + (gunluk.error && gunluk.error.message) + '\n');

    sonuc(tohum.length >= 3, 'test satırları yazıldı', tohum.join(', ') || 'hiçbiri yazılamadı');

    /* ------------------------------- 3. GERÇEK silme iş mantığı */
    let silmeSonuc;
    try {
      silmeSonuc = await db.deleteAccountData(userId, testEmail);
      sonuc(true, 'db.deleteAccountData koştu', 'silinen: ' + JSON.stringify(silmeSonuc.silinen)
        + (silmeSonuc.atlanan.length ? '  atlanan: ' + silmeSonuc.atlanan.join(',') : ''));
    } catch (e) {
      sonuc(false, 'db.deleteAccountData hata verdi', e.message);
      throw e;
    }

    const { error: errHesap } = await supabase.auth.admin.deleteUser(userId);
    sonuc(!errHesap, 'auth.users satırı silindi', errHesap ? ('hata: ' + errHesap.message) : userId);
    if (errHesap) throw new Error('hesap silinemedi');

    /* ------------------------------------- 4. Gerçekten gitti mi */
    for (const [ad, tablo, kolon, deger] of [
      ['cl_scans', 'cl_scans', 'user_id', userId],
      ['cl_device_tokens', 'cl_device_tokens', 'user_id', userId],
      ['cl_subscriptions', 'cl_subscriptions', 'user_id', userId],
      ['cl_waitlist', 'cl_waitlist', 'email', testEmail],
      ['verified_domains', 'verified_domains', 'user_id', userId],
      ['monitor_alerts', 'monitor_alerts', 'user_id', userId],
      ['scan_jobs', 'scan_jobs', 'user_id', userId]
    ]) {
      const { count, error } = await supabase.from(tablo).select('id', { count: 'exact', head: true }).eq(kolon, deger);
      if (error) {
        if (tabloYok(error)) { sonuc(true, ad + ': tablo yok (göç uygulanmamış)', 'atlandı'); continue; }
        sonuc(false, ad + ': okunamadı', error.message); continue;
      }
      sonuc(count === 0, ad + ': satır kalmadı', count + ' satır');
    }

    if (gunluk.ok && gunluk.id) {
      const { data: kalanSatir, error: errOku } = await supabase.from('scan_logs').select('id,user_id').eq('id', gunluk.id).limit(1);
      if (errOku) sonuc(false, 'scan_logs: okunamadı', errOku.message);
      else sonuc(!kalanSatir || kalanSatir.length === 0 || kalanSatir[0].user_id === null,
        'scan_logs: satır KALDI ama kişiyle bağı kesildi',
        kalanSatir && kalanSatir.length ? ('user_id=' + kalanSatir[0].user_id) : 'satır da gitmiş (kabul)');
    }

    const { data: geri, error: errGet } = await supabase.auth.admin.getUserById(userId);
    const kapandi = !!errGet || !geri;
    sonuc(kapandi, 'hesap kaydı kapandı (auth.users)', errGet ? errGet.message : 'hâlâ dönüyor');
    if (!kapandi) throw new Error('hesap hâlâ duruyor');

    dogrulandi = kalan === 0;

  } catch (e) {
    if (kalan === 0) sonuc(false, 'akış tamamlanamadı', e.message);
  } finally {
    const artik = await temizle();
    if (artik.length) {
      process.stdout.write('\n' + KIRMIZI + 'ARTIK KALDI' + SIFIRLA + ' — temizlik adımı şunları sildi: ' + artik.join(', ') + '\n');
      if (!dogrulandi) kalan++;
    } else {
      process.stdout.write('\nArtık yok: temizlik adımı silinecek bir şey bulamadı (beklenen).\n');
    }
  }

  process.stdout.write('\nGeçen: ' + gecti + '   Kalan: ' + kalan + '\n');
  if (kalan === 0 && dogrulandi) process.stdout.write(YESIL + 'DOĞRULANDI' + SIFIRLA + ' — hesap ve bağlı veri gerçekten silindi.\n');
  process.exit(kalan === 0 && dogrulandi ? 0 : 1);
})();
