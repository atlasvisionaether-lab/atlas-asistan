'use strict';

/**
 * Supabase Auth (GoTrue) istemcisi ve çerez tabanlı oturum yönetimi.
 *
 * Neden tarayıcıda Supabase JS yok:
 *   - supabase-js oturumu varsayılan olarak localStorage'a yazar. Orada duran
 *     access/refresh token'ı sayfadaki herhangi bir script okuyabilir; bir XSS
 *     doğrudan hesap devri anlamına gelir.
 *   - Dışarıdan script yüklemek, hash tabanlı CSP'yi gevşetmeyi gerektirirdi.
 *   - Projede paket bağımlılığı ve derleme adımı yok; bunu korumak istiyoruz.
 *
 * Bunun yerine: kimlik doğrulama çağrıları bu sunucu ucundan GoTrue REST
 * arayüzüne gider, oturum bizim HttpOnly + Secure + SameSite çerezlerimizde
 * taşınır. Token hiçbir zaman JavaScript'in erişebileceği bir yere yazılmaz.
 *
 * Kimlik çözümü `GET /auth/v1/user` ile yapılır; JWT imzası yerelde
 * doğrulanmaz. Bu bir tercih: imza doğrulaması iptal edilmiş oturumu, silinmiş
 * veya askıya alınmış kullanıcıyı fark edemez. Ağ turu maliyeti (~80 ms)
 * tarama süresinin yanında önemsiz.
 *
 * Gerekli ortam değişkenleri (değerleri koda yazılmaz, Vercel'de tanımlanır):
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY      — yayınlanabilir anahtar; yine de yalnızca sunucuda
 *                            kullanılır, istemci bundle'ına konmaz.
 */

const TIMEOUT_MS = 8000;

/* Erişim ve yenileme token'ı ayrı çerezlerde.

   Yenileme çerezini yalnızca /api/auth yoluna kısıtlamak istenirdi, ama o
   zaman /api/scan ve /api/history istekleri çerezi taşımaz ve erişim token'ı
   dolduğunda yenileme hiç çalışmazdı: kullanıcı bir saat sonra sessizce
   anonime düşerdi. Bu yüzden yol kökte. Koruma HttpOnly + Secure +
   SameSite=Lax üçlüsünden geliyor; yol kısıtı zaten bunların üstüne az şey
   katıyordu. */
const AT_COOKIE = 'cl_at';
const RT_COOKIE = 'cl_rt';
const RT_PATH = '/';

const RT_MAX_AGE = 60 * 60 * 24 * 30;   // 30 gün

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  return url && key ? { url: url.replace(/\/+$/, ''), key: key } : null;
}

function isConfigured() { return config() !== null; }

/**
 * GoTrue'ya istek atar. Dönüş: { ok, status, body }.
 * Hata gövdesi yukarı taşınır ama dışarıya olduğu gibi verilmez; uçlar
 * güvenli, genel kodlara çevirir.
 */
async function call(path, options) {
  const cfg = config();
  if (!cfg) throw new Error('auth_not_configured');

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  const headers = Object.assign({
    'apikey': cfg.key,
    'Content-Type': 'application/json'
  }, (options && options.headers) || {});

  let response;
  try {
    response = await fetch(cfg.url + '/auth/v1' + path, {
      method: (options && options.method) || 'POST',
      signal: controller.signal,
      headers: headers,
      body: options && options.body ? JSON.stringify(options.body) : undefined
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error('auth_unreachable');
  }
  clearTimeout(timer);

  const body = await response.json().catch(function () { return null; });
  return { ok: response.ok, status: response.status, body: body };
}

/* ------------------------------------------------------------------
   Çerezler
   ------------------------------------------------------------------ */

function parseCookies(header) {
  const jar = {};
  if (!header) return jar;
  String(header).split(';').forEach(function (part) {
    const i = part.indexOf('=');
    if (i < 1) return;
    const k = part.slice(0, i).trim();
    if (k) jar[k] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return jar;
}

function appendCookie(res, cookie) {
  const previous = res.getHeader ? res.getHeader('Set-Cookie') : null;
  if (previous) res.setHeader('Set-Cookie', [].concat(previous, cookie));
  else res.setHeader('Set-Cookie', cookie);
}

/**
 * Oturum çerezlerini yazar.
 *
 * Erişim çerezi oturumluk (Max-Age yok): tarayıcı kapanınca düşer, ama
 * yenileme çerezi 30 gün yaşadığı için kullanıcı yeniden giriş yapmak zorunda
 * kalmaz — sonraki istekte sessizce yenilenir.
 */
function setSessionCookies(res, session) {
  if (!session || !session.access_token) return;
  appendCookie(res, AT_COOKIE + '=' + session.access_token
    + '; Path=/; HttpOnly; Secure; SameSite=Lax');
  if (session.refresh_token) {
    appendCookie(res, RT_COOKIE + '=' + session.refresh_token
      + '; Max-Age=' + RT_MAX_AGE + '; Path=' + RT_PATH + '; HttpOnly; Secure; SameSite=Lax');
  }
}

function clearSessionCookies(res) {
  appendCookie(res, AT_COOKIE + '=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax');
  appendCookie(res, RT_COOKIE + '=; Max-Age=0; Path=' + RT_PATH + '; HttpOnly; Secure; SameSite=Lax');
}

function readTokens(req) {
  const jar = parseCookies(req.headers && req.headers.cookie);
  return { accessToken: jar[AT_COOKIE] || null, refreshToken: jar[RT_COOKIE] || null };
}

/* ------------------------------------------------------------------
   GoTrue işlemleri
   ------------------------------------------------------------------ */

function bearer(token) { return { 'Authorization': 'Bearer ' + token }; }

/** Kayıt. E-posta onayı açıksa oturum dönmez, onay e-postası gider. */
async function signUp(email, password, redirectTo) {
  return call('/signup' + (redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : ''),
    { body: { email: email, password: password } });
}

async function signInPassword(email, password) {
  return call('/token?grant_type=password', { body: { email: email, password: password } });
}

/** Magic link. create_user:false — bu uç yeni hesap açmaz. */
async function signInMagicLink(email, redirectTo) {
  return call('/otp' + (redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : ''),
    { body: { email: email, create_user: false } });
}

async function recover(email, redirectTo) {
  return call('/recover' + (redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : ''),
    { body: { email: email } });
}

/** E-posta bağlantısındaki tek kullanımlık kodu oturuma çevirir. */
async function verifyOtp(type, tokenHash) {
  return call('/verify', { body: { type: type, token_hash: tokenHash } });
}

async function refresh(refreshToken) {
  return call('/token?grant_type=refresh_token', { body: { refresh_token: refreshToken } });
}

async function getUser(accessToken) {
  return call('/user', { method: 'GET', headers: bearer(accessToken) });
}

async function updatePassword(accessToken, password) {
  return call('/user', { method: 'PUT', headers: bearer(accessToken), body: { password: password } });
}

async function logout(accessToken) {
  return call('/logout', { headers: bearer(accessToken) });
}

/* ------------------------------------------------------------------
   Oturum çözümü
   ------------------------------------------------------------------ */

/**
 * İsteği yapanın kimliğini çözer.
 *
 * Erişim token'ı süresi dolmuşsa yenileme token'ıyla sessizce yenilenir ve
 * yeni çerezler yanıta eklenir. Yenilenemezse oturum çerezleri temizlenir:
 * kullanıcı anonim duruma düşer, geçersiz bir çerezle dolaşmaz.
 *
 * Dönüş: { id, email, accessToken } veya null. Erişim token'ı da döner çünkü
 * yenileme sonrası çağıranın elindeki çerez artık eskidir; şifre değiştirme
 * gibi işlemler güncel token'a ihtiyaç duyar.
 */
async function resolveUser(req, res) {
  if (!isConfigured()) return null;

  const tokens = readTokens(req);

  if (tokens.accessToken) {
    let r;
    try { r = await getUser(tokens.accessToken); } catch (e) { return null; }
    if (r.ok && r.body && r.body.id) {
      return { id: r.body.id, email: r.body.email || null, accessToken: tokens.accessToken };
    }
  }

  if (!tokens.refreshToken) {
    // Erişim çerezi var ama geçersizse temizle; yoksa dokunma.
    if (tokens.accessToken) clearSessionCookies(res);
    return null;
  }

  let refreshed;
  try { refreshed = await refresh(tokens.refreshToken); } catch (e) { return null; }
  if (!refreshed.ok || !refreshed.body || !refreshed.body.access_token) {
    clearSessionCookies(res);
    return null;
  }

  setSessionCookies(res, refreshed.body);
  const fresh = refreshed.body.access_token;
  const u = refreshed.body.user;
  if (u && u.id) return { id: u.id, email: u.email || null, accessToken: fresh };

  try {
    const r2 = await getUser(fresh);
    if (r2.ok && r2.body && r2.body.id) {
      return { id: r2.body.id, email: r2.body.email || null, accessToken: fresh };
    }
  } catch (e) { /* yut */ }
  return null;
}

/* ------------------------------------------------------------------
   Doğrulama ve hata eşlemesi
   ------------------------------------------------------------------ */

/* RFC 5322'nin tamamı değil; amaç açıkça bozuk girdiyi elemek. Asıl doğrulama
   zaten onay e-postasının ulaşıp ulaşmamasıyla yapılır. */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

const PASSWORD_MIN = 10;
const PASSWORD_MAX = 72;   // bcrypt bu uzunluktan sonrasını sessizce yok sayar

function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value.trim());
}

function passwordProblem(value) {
  if (typeof value !== 'string') return 'password_too_short';
  if (value.length < PASSWORD_MIN) return 'password_too_short';
  if (value.length > PASSWORD_MAX) return 'password_too_long';
  return null;
}

/**
 * GoTrue hatasını istemciye verilebilecek genel bir koda çevirir.
 *
 * Giriş ve şifre sıfırlamada "bu e-posta kayıtlı değil" ile "şifre yanlış"
 * ayrımı dışarı sızdırılmaz: ikisi de aynı kodu döndürür. Aksi hâlde uç, hangi
 * e-postaların sistemde olduğunu sayan bir araca dönüşür.
 *
 * BAĞLAM ZORUNLU. Eskiden sondaki kural "tanımadığın her 400/401/403 →
 * invalid_credentials" diyordu ve bu, kayıt akışında yalan söylüyordu: yepyeni
 * bir e-postayla kayıt olmaya çalışan kullanıcı, kaydı reddedilmesinin
 * sebebinden bağımsız olarak "E-posta veya şifre hatalı" görüyordu. Şifresi
 * gayet doğruyken. Üretimde tam olarak bu yaşandı.
 *
 * "Şifre yanlış" YALNIZCA bir kimlik doğrulama denemesi için anlamlı bir
 * cevaptır. Kayıtta bilinmeyen bir 4xx, kullanıcının hatası olmayabilir —
 * ve öyle sunulmamalı.
 *
 * @param {number} status  GoTrue HTTP durumu
 * @param {object} body    GoTrue gövdesi
 * @param {string} context 'signin' (giriş/şifre denemesi) veya 'signup' (kayıt)
 */
function mapError(status, body, context) {
  const code = (body && (body.error_code || body.code)) || '';
  const msg = String((body && (body.msg || body.message || body.error_description)) || '');

  if (status === 429 || code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') {
    return 'too_many_requests';
  }
  /* Geçersiz veya eksik API anahtarı. Bu ASLA kullanıcının hatası değildir ve
     bağlamdan bağımsızdır: ne şifresi yanlıştır, ne e-postası. Ayrı bir kod
     olması şart, çünkü eski yakala-hepsini kural bunu 'invalid_credentials'a
     çeviriyordu ve üretim doğrulaması "hatalı giriş reddedildi" kontrolünü
     GEÇİYORDU — arıza tam oradayken. Bir kez yaşandı, tekrarlamasın. */
  if (/invalid api key|no api key found/i.test(msg) || code === 'no_authorization') {
    return 'auth_misconfigured';
  }
  if (code === 'user_already_exists' || /already registered/i.test(msg)) return 'email_taken';
  if (code === 'email_not_confirmed' || /not confirmed/i.test(msg)) return 'email_not_confirmed';
  if (code === 'weak_password') return 'weak_password';

  // Kimlik bilgisi hatası, bağlantı hatasından ÖNCE bakılmalı: GoTrue'nun
  // "Invalid login credentials" mesajı da "invalid" kelimesini içeriyor ve
  // geniş bir desen bunu yanlışlıkla "bağlantı geçersiz" diye raporluyordu.
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) {
    return 'invalid_credentials';
  }
  if (code === 'otp_expired' || code === 'otp_disabled'
      || /token has expired|invalid token|otp/i.test(msg)) {
    return 'link_invalid';
  }
  // GoTrue, auth.users'a yazma sirasinda bir veritabani tetikleyicisi hata
  // verirse 500 + "Database error saving new user" doner. Bu proje baska bir
  // uygulamayla paylasildigi ve auth.users uzerinde onlara ait tetikleyiciler
  // bulundugu icin bu gercek bir olasilik. Genel 'auth_failed' yerine ayri bir
  // kod donuyoruz: kullanici anlamli bir mesaj gorur, biz de logdan teshis
  // edebiliriz. Ayrinti docs/auth.md § 8'de.
  if (code === 'unexpected_failure' || /database error/i.test(msg)) {
    return 'signup_unavailable';
  }

  /* Kaydın reddedilme sebepleri — hiçbiri "şifren yanlış" değil.
     Bunlar açıkça ayrılıyor ki kullanıcı doğru şeyi görsün, biz de logdan
     gerçek sebebi okuyabilelim. */
  if (code === 'signup_disabled' || /signups not allowed/i.test(msg)) return 'signup_disabled';
  if (code === 'email_provider_disabled' || /email( logins| signups)? (are )?disabled/i.test(msg)) {
    return 'signup_disabled';
  }
  if (code === 'email_address_not_authorized' || /not authorized/i.test(msg)) return 'email_not_allowed';
  if (code === 'email_address_invalid' || /email address.*invalid/i.test(msg)) return 'invalid_email';
  if (code === 'captcha_failed' || /captcha/i.test(msg)) return 'captcha_failed';
  /* Yönlendirme adresi Supabase'in izinli listesinde değilse GoTrue kaydı
     400 ile reddeder. Ortam adresi değiştiğinde (yeni alan adı, yeni preview)
     tam olarak bu olur ve eski kod bunu "şifreniz hatalı" diye gösteriyordu. */
  if (/redirect|invalid.*url/i.test(msg)) return 'redirect_not_allowed';
  if (code === 'validation_failed') {
    return context === 'signup' ? 'signup_rejected' : 'invalid_credentials';
  }

  if (status === 400 || status === 401 || status === 403) {
    /* Bağlam olmadan bu satır tahmin yürütür. Kayıtta tahmin etmiyoruz. */
    return context === 'signup' ? 'signup_rejected' : 'invalid_credentials';
  }
  return 'auth_failed';
}

/**
 * Başarısız bir GoTrue çağrısını sunucu günlüğüne yazar.
 *
 * E-POSTA VE ŞİFRE ASLA YAZILMAZ. Yazılan şey yalnızca akış adı, HTTP durumu
 * ve GoTrue'nun kendi hata kodu/mesajı — yani sorunu teşhis etmeye yetecek
 * kadarı, kullanıcının kimliğini açığa çıkarmadan.
 *
 * Neden gerekiyordu: üretimde kayıt bozulduğunda elimizde tek bir kayıt yoktu.
 * Hata mesajı sebebi maskeliyordu ve arkasında ne olduğunu görmenin yolu yoktu.
 */
function logFailure(flow, status, body, mappedCode) {
  if (!console || !console.error) return;
  const code = (body && (body.error_code || body.code)) || '-';
  const msg = String((body && (body.msg || body.message || body.error_description)) || '-');
  console.error('auth ' + flow + ' failed: http=' + status +
                ' gotrue_code=' + code +
                ' mapped=' + mappedCode +
                ' msg=' + redact(msg).slice(0, 200));
}

/**
 * Günlüğe yazılacak metinden e-posta adreslerini siler.
 *
 * GoTrue bazı hatalarda adresi mesajın içine koyuyor ("Email address X is
 * invalid" gibi). Teşhis için hata kodu yeterli; adres değil. Bu olmadan
 * teşhis günlüğü, çözmeye çalıştığı sorundan daha kötü bir soruna dönerdi.
 */
function redact(text) {
  return String(text).replace(/[^\s<>()"']+@[^\s<>()"']+/g, '[e-posta]');
}

/**
 * E-posta bağlantılarının döneceği adres.
 *
 * Sabit ve sunucu tarafında belirlenir; istemciden gelen bir değere göre
 * ayarlanmaz. Aksi hâlde saldırgan, onay bağlantısını kendi sitesine
 * yönlendirecek bir kayıt isteği tetikleyebilirdi.
 */
function siteUrl() {
  return (process.env.PUBLIC_SITE_URL || 'https://www.cyberlionai.com').replace(/\/+$/, '');
}

module.exports = {
  isConfigured, call,
  validEmail, passwordProblem, mapError, logFailure, siteUrl, PASSWORD_MIN, PASSWORD_MAX,
  signUp, signInPassword, signInMagicLink, recover, verifyOtp,
  refresh, getUser, updatePassword, logout,
  setSessionCookies, clearSessionCookies, readTokens, resolveUser,
  AT_COOKIE, RT_COOKIE
};
