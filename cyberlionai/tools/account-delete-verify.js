'use strict';

/**
 * Hesap silme ucunun ÜRETİMDE doğrulanması — kendi açtığı test hesabıyla.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... BASE=https://www.cyberlionai.com \
 *   CONFIRM=evet node cyberlionai/tools/account-delete-verify.js
 *
 * NEDEN BÖYLE
 *
 * Silme geri alınamaz. Gerçek bir kullanıcıya dokunmadan sınamanın tek yolu,
 * sınamanın KENDİ hesabını açıp kendi hesabını silmesi. Betik bu yüzden
 * sırayla: test hesabı açar → ona ait satırlar yazar → ucu çağırır →
 * satırların GERÇEKTEN gittiğini ve hesabın kapandığını okur → ne olursa
 * olsun artığı temizler.
 *
 * ÜRETİM VERİTABANINA YAZAR. Bu yüzden `CONFIRM=evet` olmadan hiçbir şey
 * yapmaz, yalnızca ne yapacağını yazar. Açtığı hesap ve yazdığı satırlar
 * betiğin sonunda KALMAZ: silme çalışmazsa temizlik adımı aynı satırları
 * servis rolüyle siler ve çıktıda "ARTIK KALDI" uyarısı verir.
 *
 * ANAHTARLAR: ortam değişkeninden okunur, hiçbir yere yazılmaz, çıktıda
 * maskelenmez bile — hiç basılmaz. Test şifresi koşu sırasında üretilir.
 *
 * ÖLÇMEDİĞİ ŞEY: tarayıcı arayüzü. Panel düğmesi ve /hesap-silme sayfası
 * ağsız sınamayla kilitli (tools/account-delete-test.js); burada ölçülen
 * şey ucun ve veritabanı tarafının davranışı.
 */

const crypto = require('crypto');

const BASE = (process.env.BASE || 'https://www.cyberlionai.com').replace(/\/+$/, '');
const URL_SB = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BYPASS = (process.env.BYPASS || '').trim();
const CONFIRM = process.env.CONFIRM || '';

const KALIN = '\x1b[1m';
const YESIL = '\x1b[32m';
const KIRMIZI = '\x1b[31m';
const SIFIRLA = '\x1b[0m';

const ZAMAN_ASIMI = 15000;

let gecti = 0;
let kalan = 0;
function sonuc(ok, ad, ek) {
  if (ok) { gecti++; process.stdout.write('  ' + YESIL + 'GEÇTİ' + SIFIRLA + '  ' + ad + (ek ? ' — ' + ek : '') + '\n'); }
  else { kalan++; process.stdout.write('  ' + KIRMIZI + 'KALDI' + SIFIRLA + '  ' + ad + (ek ? ' — ' + ek : '') + '\n'); }
}

async function istek(url, secenek) {
  const kontrolcu = new AbortController();
  const zamanlayici = setTimeout(function () { kontrolcu.abort(); }, ZAMAN_ASIMI);
  try {
    const y = await fetch(url, Object.assign({ signal: kontrolcu.signal }, secenek || {}));
    clearTimeout(zamanlayici);
    const metin = await y.text().catch(function () { return ''; });
    let govde = null;
    try { govde = metin ? JSON.parse(metin) : null; } catch (e) { govde = null; }
    return { ok: y.ok, status: y.status, govde: govde, metin: metin };
  } catch (e) {
    clearTimeout(zamanlayici);
    return { ok: false, status: 0, hata: e && e.name === 'AbortError' ? 'timeout' : (e.message || 'error') };
  }
}

function servisBasliklari() {
  return { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' };
}

/** PostgREST üzerinden okuma/yazma (servis rolü). */
function rest(yol, secenek) {
  return istek(URL_SB + '/rest/v1/' + yol, Object.assign({
    headers: Object.assign(servisBasliklari(), (secenek && secenek.headers) || {})
  }, secenek || {}));
}

(async function () {
  process.stdout.write(KALIN + 'Hesap silme ucu — üretim doğrulaması (test hesabıyla)' + SIFIRLA + '\n');
  process.stdout.write('Hedef : ' + BASE + '\n');
  process.stdout.write('Zaman : ' + new Date().toISOString() + '\n\n');

  if (!URL_SB || !KEY) {
    process.stdout.write('ÖLÇÜLEMEDİ — SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli.\n');
    process.stdout.write('Bu iki değer olmadan ne test hesabı açılabilir ne de silmenin\n');
    process.stdout.write('gerçekten olduğu okunabilir. Anahtarlar GitHub deposu gizli\n');
    process.stdout.write('değişkenlerine (Settings → Secrets → Actions) eklenir; sohbete\n');
    process.stdout.write('yazılmaz. Tahmin edilmiyor, ölçüm atlanıyor.\n');
    process.exit(2);
  }

  if (CONFIRM !== 'evet') {
    process.stdout.write('ONAY YOK — hiçbir şey yapılmadı.\n\n');
    process.stdout.write('Bu betik ÜRETİM veritabanına yazar ve siler:\n');
    process.stdout.write('  1. hesap-silme-testi-<rastgele>@cyberlionai.com adında test hesabı açar\n');
    process.stdout.write('     (e-posta onaylı olarak açılır, GERÇEK e-posta GİTMEZ)\n');
    process.stdout.write('  2. o hesaba ait cl_scans / cl_device_tokens / cl_waitlist / scan_logs satırı yazar\n');
    process.stdout.write('  3. DELETE /api/panel/account çağırır (Bearer, kendi hesabı)\n');
    process.stdout.write('  4. satırların gittiğini, scan_logs satırının user_id=NULL ile KALDIĞINI okur\n');
    process.stdout.write('  5. ne olursa olsun artığı temizler\n\n');
    process.stdout.write('Gerçek kullanıcılara DOKUNMAZ: tüm sorgular bu test hesabının kimliğiyle sınırlı.\n');
    process.stdout.write('Onaylıyorsanız CONFIRM=evet ile tekrar koşun.\n');
    process.exit(0);
  }

  /* --------------------------------------------------- 1. Test hesabı */
  const rastgele = crypto.randomBytes(6).toString('hex');
  const eposta = 'hesap-silme-testi-' + rastgele + '@cyberlionai.com';
  /* Şifre koşu sırasında üretilir; hiçbir yere yazılmaz, basılmaz. */
  const sifre = crypto.randomBytes(18).toString('base64url') + 'Aa1!';

  const olustur = await istek(URL_SB + '/auth/v1/admin/users', {
    method: 'POST',
    headers: servisBasliklari(),
    body: JSON.stringify({ email: eposta, password: sifre, email_confirm: true })
  });
  const userId = olustur.govde && olustur.govde.id;
  sonuc(!!userId, 'test hesabı açıldı', userId ? eposta : ('HTTP ' + olustur.status + ' ' + (olustur.hata || '')));
  if (!userId) { process.stdout.write('\nDevam edilemiyor.\n'); process.exit(1); }

  /* Temizlik her yolda çalışsın. */
  async function temizle() {
    const artik = [];
    for (const yol of [
      'cl_scans?user_id=eq.' + userId,
      'cl_device_tokens?user_id=eq.' + userId,
      'cl_subscriptions?user_id=eq.' + userId,
      'cl_waitlist?email=eq.' + encodeURIComponent(eposta),
      'scan_logs?user_id=eq.' + userId
    ]) {
      const r = await rest(yol, { method: 'DELETE', headers: { 'Prefer': 'return=representation' } });
      if (r.ok && Array.isArray(r.govde) && r.govde.length) artik.push(yol.split('?')[0] + '=' + r.govde.length);
    }
    const u = await istek(URL_SB + '/auth/v1/admin/users/' + userId, { method: 'DELETE', headers: servisBasliklari() });
    if (u.ok) artik.push('auth.users=1');
    return artik;
  }

  let kapandi = false;
  try {
    /* ------------------------------------------------- 2. Satır tohumla */
    const tohum = [];
    const scans = await rest('cl_scans', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({ user_id: userId, host: 'example.com', score: 50, checks_total: 1 })
    });
    if (scans.ok) tohum.push('cl_scans');
    const jeton = await rest('cl_device_tokens', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({ user_id: userId, token: 'silme-testi-' + rastgele, platform: 'android' })
    });
    if (jeton.ok) tohum.push('cl_device_tokens');
    const bekleme = await rest('cl_waitlist', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({ email: eposta, plan: 'pro', domain: 'example.com' })
    });
    if (bekleme.ok) tohum.push('cl_waitlist');
    const gunluk = await rest('scan_logs', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({ user_id: userId, domain: 'example.com', level: 'passive', verified: false, consent: false })
    });
    if (gunluk.ok) tohum.push('scan_logs');

    sonuc(tohum.length >= 3, 'test satırları yazıldı', tohum.join(', ') || 'hiçbiri yazılamadı');

    /* ------------------------------------------------- 3. Oturum ve çağrı */
    const token = await istek(URL_SB + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: servisBasliklari(),
      body: JSON.stringify({ email: eposta, password: sifre })
    });
    const erisim = token.govde && token.govde.access_token;
    sonuc(!!erisim, 'test hesabıyla oturum açıldı', erisim ? 'Bearer yolu' : ('HTTP ' + token.status));
    if (!erisim) throw new Error('oturum açılamadı');

    const basliklar = {
      'Authorization': 'Bearer ' + erisim,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    if (BYPASS) basliklar['x-vercel-protection-bypass'] = BYPASS;

    /* Onay dizgesi olmadan silinmemeli: ucun kapısı üretimde de duruyor mu? */
    const onaysiz = await istek(BASE + '/api/panel/account', {
      method: 'DELETE', headers: basliklar, body: JSON.stringify({})
    });
    sonuc(onaysiz.status === 400 && onaysiz.govde && onaysiz.govde.error
      && onaysiz.govde.error.code === 'confirmation_required',
      'onaysız DELETE reddedildi', 'HTTP ' + onaysiz.status);

    const silme = await istek(BASE + '/api/panel/account', {
      method: 'DELETE', headers: basliklar, body: JSON.stringify({ confirm: 'HESABIMI SIL' })
    });
    sonuc(silme.status === 200 && silme.govde && silme.govde.ok === true,
      'DELETE /api/panel/account 200 döndü', 'HTTP ' + silme.status
      + (silme.govde && silme.govde.error ? ' ' + silme.govde.error.code : ''));
    if (silme.govde) {
      process.stdout.write('         yanıt: ' + JSON.stringify({
        deleted: silme.govde.deleted, anonymized: silme.govde.anonymized, skipped: silme.govde.skipped
      }) + '\n');
    }

    /* ------------------------------------------------- 4. Gerçekten gitti mi */
    for (const [ad, yol] of [
      ['cl_scans', 'cl_scans?select=id&user_id=eq.' + userId],
      ['cl_device_tokens', 'cl_device_tokens?select=id&user_id=eq.' + userId],
      ['cl_subscriptions', 'cl_subscriptions?select=id&user_id=eq.' + userId],
      ['cl_waitlist', 'cl_waitlist?select=id&email=eq.' + encodeURIComponent(eposta)],
      ['verified_domains', 'verified_domains?select=id&user_id=eq.' + userId],
      ['monitor_alerts', 'monitor_alerts?select=id&user_id=eq.' + userId],
      ['scan_jobs', 'scan_jobs?select=id&user_id=eq.' + userId]
    ]) {
      const r = await rest(yol);
      const sayi = Array.isArray(r.govde) ? r.govde.length : null;
      if (r.status === 404) { sonuc(true, ad + ': tablo yok (göç uygulanmamış)', 'atlandı'); continue; }
      sonuc(sayi === 0, ad + ': satır kalmadı', sayi === null ? ('okunamadı HTTP ' + r.status) : (sayi + ' satır'));
    }

    if (tohum.indexOf('scan_logs') !== -1) {
      const r = await rest('scan_logs?select=id,user_id&domain=eq.example.com&order=id.desc&limit=5');
      const bagli = Array.isArray(r.govde)
        ? r.govde.filter(function (x) { return x.user_id === userId; }).length : null;
      sonuc(bagli === 0, 'scan_logs: satır KALDI ama kişiyle bağı kesildi',
        bagli === null ? ('okunamadı HTTP ' + r.status) : (bagli + ' satır hâlâ bu hesaba bağlı'));
    }

    const hesap = await istek(URL_SB + '/auth/v1/admin/users/' + userId, { headers: servisBasliklari() });
    kapandi = hesap.status === 404;
    sonuc(kapandi, 'hesap kaydı kapandı (auth.users)', 'HTTP ' + hesap.status);

    /* Silinmiş hesabın token'ı artık iş görmemeli. */
    const sonra = await istek(BASE + '/api/panel/subscription', { headers: basliklar });
    sonuc(sonra.status === 401 || sonra.status === 403,
      'silinmiş hesabın belirteci artık kabul edilmiyor', 'HTTP ' + sonra.status);

  } catch (e) {
    sonuc(false, 'akış tamamlanamadı', e.message);
  } finally {
    const artik = await temizle();
    if (artik.length) {
      process.stdout.write('\n' + KIRMIZI + 'ARTIK KALDI' + SIFIRLA
        + ' — temizlik adımı şunları sildi: ' + artik.join(', ') + '\n');
      process.stdout.write('Bu satırlar uç tarafından silinmiş OLMALIYDI; üstteki sonuçlara bakın.\n');
      if (!kapandi) kalan++;
    } else {
      process.stdout.write('\nArtık yok: temizlik adımı silinecek bir şey bulamadı (beklenen).\n');
    }
  }

  process.stdout.write('\nGeçen: ' + gecti + '   Kalan: ' + kalan + '\n');
  process.exit(kalan === 0 ? 0 : 1);
})();
