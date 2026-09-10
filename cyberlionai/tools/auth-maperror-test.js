'use strict';

/**
 * mapError sınamaları.
 *
 *   node tools/auth-maperror-test.js
 *
 * Neden var: üretimde yepyeni bir e-postayla kayıt olmaya çalışan kullanıcı
 * "E-posta veya şifre hatalı" gördü. Sebep, sondaki "tanımadığın her 4xx →
 * invalid_credentials" kuralıydı. Bu sınama o davranışın geri gelmesini
 * engelliyor.
 *
 * Ağa çıkmaz.
 */

const auth = require('../api/_lib/auth.js');

let failed = 0;
function ok(cond, msg) {
  process.stdout.write((cond ? '  \x1b[32mPASS\x1b[0m  ' : '  \x1b[31mFAIL\x1b[0m  ') + msg + '\n');
  if (!cond) failed = 1;
}
function head(t) { process.stdout.write('\n\x1b[1m== ' + t + '\x1b[0m\n'); }
function esle(status, body, context) { return auth.mapError(status, body, context); }

head('ÜRETİM BELİRTİSİ — kayıtta asla "şifre yanlış" denmez');
// Uretimde gorulen tam durum: yepyeni e-posta, dogru sifre, GoTrue 400.
const belirti = esle(400, { msg: 'Something went wrong' }, 'signup');
ok(belirti !== 'invalid_credentials',
   'tanınmayan 400, kayıtta invalid_credentials DEĞİL (gelen: ' + belirti + ')');
ok(belirti === 'signup_rejected', 'kayıt için signup_rejected dönüyor');
ok(esle(401, {}, 'signup') !== 'invalid_credentials', 'tanınmayan 401 de kayıtta credential hatası değil');
ok(esle(403, {}, 'signup') !== 'invalid_credentials', 'tanınmayan 403 de kayıtta credential hatası değil');

head('Giriş bağlamı korunuyor — orada "şifre yanlış" doğru cevap');
ok(esle(400, { msg: 'Invalid login credentials' }, 'signin') === 'invalid_credentials',
   'GoTrue credential hatası hâlâ invalid_credentials');
ok(esle(400, { error_code: 'invalid_credentials' }, 'signin') === 'invalid_credentials',
   'kod ile gelen credential hatası');
ok(esle(401, {}, 'signin') === 'invalid_credentials', 'girişte tanınmayan 401 credential hatası sayılır');
// Kullanici sayimini engelleyen davranis bozulmamali.
ok(esle(400, { msg: 'Invalid login credentials' }, 'signin') === esle(401, {}, 'signin'),
   'giriş: "kayıtlı değil" ile "şifre yanlış" hâlâ ayırt edilemiyor');

head('Kaydın gerçek reddedilme sebepleri ayrı ayrı tanınıyor');
ok(esle(400, { msg: 'Invalid redirect URL' }, 'signup') === 'redirect_not_allowed',
   'izinsiz yönlendirme adresi → redirect_not_allowed');
ok(esle(422, { error_code: 'signup_disabled' }, 'signup') === 'signup_disabled',
   'kayıt kapalı → signup_disabled');
ok(esle(422, { msg: 'Signups not allowed for this instance' }, 'signup') === 'signup_disabled',
   'kayıt kapalı (mesajdan) → signup_disabled');
ok(esle(422, { error_code: 'email_provider_disabled' }, 'signup') === 'signup_disabled',
   'e-posta sağlayıcı kapalı → signup_disabled');
ok(esle(400, { error_code: 'email_address_not_authorized' }, 'signup') === 'email_not_allowed',
   'izinli listede olmayan e-posta → email_not_allowed');
ok(esle(400, { error_code: 'email_address_invalid' }, 'signup') === 'invalid_email',
   'GoTrue e-postayı geçersiz buldu → invalid_email');
ok(esle(400, { error_code: 'captcha_failed' }, 'signup') === 'captcha_failed',
   'captcha → captcha_failed');

head('Var olan eşlemeler bozulmadı');
ok(esle(400, { error_code: 'user_already_exists' }, 'signup') === 'email_taken', 'e-posta zaten kayıtlı');
ok(esle(400, { msg: 'User already registered' }, 'signup') === 'email_taken', 'mesajdan e-posta zaten kayıtlı');
ok(esle(400, { error_code: 'email_not_confirmed' }, 'signin') === 'email_not_confirmed', 'onaylanmamış e-posta');
ok(esle(422, { error_code: 'weak_password' }, 'signup') === 'weak_password', 'zayıf şifre');
ok(esle(429, {}, 'signup') === 'too_many_requests', 'hız sınırı');
ok(esle(400, { error_code: 'over_email_send_rate_limit' }, 'signup') === 'too_many_requests', 'e-posta gönderim sınırı');
ok(esle(500, { msg: 'Database error saving new user' }, 'signup') === 'signup_unavailable',
   'veritabanı tetikleyicisi → signup_unavailable');
ok(esle(400, { error_code: 'otp_expired' }, 'signup') === 'link_invalid', 'süresi dolmuş bağlantı');
ok(esle(500, {}, 'signin') === 'auth_failed', 'tanınmayan 500 → auth_failed');

head('logFailure gizliliği koruyor');
const yazilan = [];
const gercek = console.error;
console.error = function () { yazilan.push(Array.prototype.join.call(arguments, ' ')); };
auth.logFailure('signup', 400, { error_code: 'validation_failed', msg: 'Invalid redirect URL' }, 'redirect_not_allowed');
console.error = gercek;
const satir = yazilan.join('\n');
ok(yazilan.length === 1, 'tek satır yazıldı');
ok(satir.indexOf('http=400') > -1 && satir.indexOf('validation_failed') > -1,
   'HTTP durumu ve GoTrue kodu yazıldı — teşhis için gereken bu');
ok(satir.indexOf('redirect_not_allowed') > -1, 'eşlenen kod da yazıldı');
// logFailure'a e-posta/sifre hic verilmiyor; imza bunu yapisal olarak engelliyor.
ok(auth.logFailure.length === 4, 'logFailure yalnızca akış, durum, gövde ve kod alır — kimlik bilgisi almaz');

// GoTrue bazi hatalarda adresi mesajin icine koyuyor. Teshis gunlugu, cozmeye
// calistigi sorundan daha kotu bir soruna donmemeli.
const yazilan2 = [];
console.error = function () { yazilan2.push(Array.prototype.join.call(arguments, ' ')); };
auth.logFailure('signup', 400, { error_code: 'email_address_invalid',
  msg: 'Email address kullanici@ornek.com is invalid' }, 'invalid_email');
console.error = gercek;
ok(yazilan2[0].indexOf('kullanici@ornek.com') === -1, 'e-posta adresi günlüğe YAZILMIYOR');
ok(yazilan2[0].indexOf('[e-posta]') > -1, 'adresin yeri işaretleniyor');
ok(yazilan2[0].indexOf('email_address_invalid') > -1, 'hata kodu korunuyor — teşhis için gereken bu');

process.stdout.write('\n\x1b[1m' + (failed ? 'SONUÇ: BAŞARISIZ' : 'SONUÇ: HEPSİ GEÇTİ') + '\x1b[0m\n');
process.exit(failed);
