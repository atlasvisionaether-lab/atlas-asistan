'use strict';

/**
 * Dil modeline gitmeden önce hassas değerleri maskeler.
 *
 * NEDEN
 *
 * Asistana yazılan metin dış bir sağlayıcıya (DeepSeek, yedekte Anthropic)
 * gidiyor. Kullanıcı arayüzde uyarılıyor ("şifre girmeyin"), ama hata logu
 * yapıştıran biri farkında olmadan IP, e-posta, oturum çerezi ya da API
 * anahtarı gönderebilir. Bu katman uyarının arkasındaki emniyet kemeri:
 * yakaladığını sağlayıcıya göndermeden önce yer tutucuyla değiştirir.
 *
 * NE MASKELENMEZ
 *
 * Alan adları ve URL'ler: asistan "example.com'un CSP'si" sorusunu ancak alan
 * adını görerek cevaplayabilir. Kod blokları da olduğu gibi kalır; yalnızca
 * içlerindeki anahtar/şifre biçimli değerler maskelenir.
 *
 * Desenler bilinçli olarak geniş: bir anahtarın modele gitmesi, bir sayının
 * gereksiz yere maskelenmesinden çok daha pahalı.
 */

/* Sıra önemli: özel biçimler (JWT, özel anahtar bloğu) genel desenlerden
   (uzun sayı dizisi) önce yakalanmalı, yoksa parçalanıp yarım kalırlar. */
const RULES = [
  /* PEM özel anahtar bloğu */
  { tag: '[gizli-anahtar]', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  /* JWT (üç base64url parça) */
  { tag: '[jwt]', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  /* Bilinen sağlayıcı anahtar önekleri */
  { tag: '[api-anahtari]', re: /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|nvapi-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|AKIA[0-9A-Z]{16}|sandbox-[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{16,})\b/g },
  /* Cookie / Set-Cookie başlığı: değerin TAMAMI satır sonuna kadar. Genel
     anahtar=değer kuralı ';' ile durduğu için "Cookie: a=1; sid=..." içinde
     yalnızca ilk değeri gizliyordu (inceleme bulgusu). */
  { tag: '$1[gizli]', re: /(\b(?:set-)?cookie\s*:\s*)[^\r\n]+/gi },
  /* Authorization: Bearer <...> / Basic <...> */
  { tag: '$1[gizli]', re: /(\b(?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]{12,}/gi },
  /* anahtar=değer biçiminde şifre/sır/token (password=..., "secret": "...", şifre: ...) */
  { tag: '$1[gizli]', re: /((?:pass(?:word|wd)?|pwd|şifre|sifre|parola|secret|token|api[_-]?key|apikey|access[_-]?key|client[_-]?secret|private[_-]?key|cookie|set-cookie|session(?:id)?)["']?\s*[:=]\s*["']?)[^\s"',;&]{4,}/gi },
  /* E-posta */
  { tag: '[e-posta]', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  /* IPv6 (en az üç grup, :: kısaltması dahil) */
  { tag: '[ip]', re: /\b(?:[0-9a-f]{1,4}:){2,7}(?::|[0-9a-f]{1,4})\b|\b(?:[0-9a-f]{1,4}:){1,6}:[0-9a-f]{1,4}\b/gi },
  /* IPv4 */
  { tag: '[ip]', re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
  /* Telefon, kart, T.C. kimlik: 10+ haneli sayı dizisi (boşluk/tire ile ayrılmış olabilir) */
  { tag: '[numara]', re: /(?<![\w.])\+?\d(?:[\s-]?\d){9,}(?![\w.])/g }
];

/**
 * Metni maskeler.
 * Dönüş: { text, count } — count, kaç değerin maskelendiği (arayüzde
 * "2 hassas değer gizlendi" demek için; değerlerin kendisi dönmez).
 */
function redact(input) {
  let text = String(input === null || input === undefined ? '' : input);
  let count = 0;
  for (const rule of RULES) {
    text = text.replace(rule.re, function () {
      count += 1;
      /* '$1' içeren etiketlerde ilk yakalama grubu (anahtar adı) korunur. */
      return rule.tag.indexOf('$1') === 0 ? arguments[1] + rule.tag.slice(2) : rule.tag;
    });
  }
  return { text: text, count: count };
}

module.exports = { redact };
