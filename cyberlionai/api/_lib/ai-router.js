'use strict';

/**
 * Hibrit yönlendirme: soru hızlı modele mi (flash), derin modele mi (pro)?
 *
 * Kural tabanlı ve deterministik: aynı mesaj (aynı geçmişle) her zaman aynı
 * katmana gider. Bir dil modeline "bu soru zor mu?" diye sormak hem ikinci bir
 * ücretli çağrı hem de sınanamayan bir karar olurdu.
 *
 * PRO'YA GİDENLER
 *   - kod bloğu, yığın izi (stack trace) ya da çok satırlı log
 *   - kod düzeltme, zafiyet yorumu, saldırı simülasyonu / red team, yapılandırma
 *     incelemesi niyetini taşıyan kelimeler
 *   - uzun mesaj (tek satırlık bir tanım sorusu 400 karakteri geçmez)
 *
 * Geri kalan her şey FLASH: "SSL nedir?", "HSTS ne işe yarar?" gibi tanım ve
 * kısa bilgi soruları.
 *
 * Kararın gerekçesi (`reasons`) yanıtla birlikte loglanabilir; içinde mesaj
 * metni yok, yalnızca kural adları var.
 */

const { normalize } = require('./kb.js');

const LONG_MESSAGE = 400;
const MULTILINE = 4;

/* Kelime BAŞINDA aranır (Türkçe ekler: "düzelt" → "düzeltir", "düzeltilmiş").
   '=' ile başlayanlar TAM kelime: "log" önek olsa "login"/"logo"yu, "acik"
   önek olsa "açıkla"yı (= anlat) yakalardı. Hepsi normalize() çıktısıyla
   karşılaştırıldığı için ASCII yazılır. */
const DEEP_KEYWORDS = [
  /* kod / hata */
  'kod', 'code', 'script', 'fonksiyon', 'function', 'hata log', 'error log', '=log',
  'stack', 'traceback', 'exception', 'debug', 'derle', 'compile',
  '=loglar', '=loglari', '=loglara', '=loglarda', '=logu', '=logda', '=logs',
  /* düzeltme */
  'duzelt', 'fix', 'patch', 'yama', 'refactor', 'yeniden yaz', 'rewrite',
  /* zafiyet */
  'zafiyet', '=acik', '=aciklar', '=aciklari', '=acigi', '=acigini', '=aciklarini', 'vulnerab', 'cve', 'cwe', 'owasp', 'exploit', 'istismar',
  'xss', 'sqli', 'sql injection', 'injection', 'enjeksiyon', 'csrf', 'ssrf', 'rce',
  'lfi', 'rfi', 'idor', 'deserializ', 'path traversal',
  /* saldırı simülasyonu */
  'red team', 'redteam', 'saldiri', 'attack', 'hackle', 'hacklen', 'hack',
  'sizma', 'pentest', 'penetrasyon', 'simulasyon', 'simulat', 'tehdit model', 'threat model',
  /* inceleme / yapılandırma */
  'analiz', 'analy', 'incele', 'review', 'denetle', 'audit', 'yapilandirma', 'config',
  'nginx', 'apache', 'htaccess', 'iis', 'cloudflare kural', 'waf kural'
];

/* Yığın izi / log satırı işaretleri (normalize edilmemiş metinde aranır). */
const TRACE_PATTERNS = [
  /\n\s+at\s+\S+.*\(.*:\d+(:\d+)?\)/,            // JS/Java: "    at foo (file.js:10:5)"
  /Traceback \(most recent call last\)/,         // Python
  /\b[A-Z][A-Za-z]+(Error|Exception)\b:/,        // TypeError: / NullPointerException:
  /\bSQLSTATE\[\w+\]/,                           // PHP PDO
  /\bPHP (Fatal|Warning|Notice|Parse) error/i,
  /\[(error|crit|alert|emerg)\]/i,               // Apache / Nginx error log
  /\b(HTTP\/\d(\.\d)?" )?[45]\d\d \d+\b.*"(GET|POST|PUT|DELETE)/ // erişim logu
];

function hasKeyword(normalized, words, keyword) {
  if (keyword.charAt(0) === '=') return words.indexOf(keyword.slice(1)) !== -1;
  if (keyword.indexOf(' ') !== -1) return normalized.indexOf(keyword) !== -1;
  for (let i = 0; i < words.length; i += 1) {
    if (words[i].indexOf(keyword) === 0) return true;
  }
  return false;
}

/**
 * Karar: { tier: 'flash' | 'pro', reasons: string[] }
 * `history` yalnızca son kullanıcı mesajı için bakılır: "peki bunu nasıl
 * düzeltirim?" gibi bir devam sorusu, önceki mesaj log içeriyorsa pro'da kalır.
 */
function route(message, history) {
  const text = String(message || '');
  const reasons = [];

  if (/```/.test(text)) reasons.push('code_block');
  if (TRACE_PATTERNS.some(function (re) { return re.test(text); })) reasons.push('trace');
  if (text.split('\n').length >= MULTILINE) reasons.push('multiline');
  if (text.length >= LONG_MESSAGE) reasons.push('long');

  const normalized = normalize(text);
  const words = normalized.split(' ').filter(Boolean);
  const hit = DEEP_KEYWORDS.find(function (k) { return hasKeyword(normalized, words, k); });
  if (hit) reasons.push('keyword:' + hit);

  if (!reasons.length && Array.isArray(history)) {
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const h = history[i];
      if (h && h.role === 'user' && typeof h.text === 'string') {
        if (route(h.text, null).tier === 'pro') reasons.push('context');
        break;
      }
    }
  }

  return { tier: reasons.length ? 'pro' : 'flash', reasons: reasons };
}

module.exports = { route, DEEP_KEYWORDS };
