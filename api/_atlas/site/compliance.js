'use strict';

/**
 * Sağlık/güzellik tanıtımı için metin denetimi (yayın kapısı).
 *
 * Sağlık hizmetlerinin tanıtımı mevzuatla sınırlıdır: sonuç garantisi, kesinlik,
 * "en iyi" gibi üstünlük iddiaları, tedavi/iyileştirme vaadi, öncesi/sonrası
 * karşılaştırması ve korku/aciliyet yaratan ifadeler riskli. Bu liste bir HUKUKİ
 * GÖRÜŞ DEĞİLDİR; amacı bariz riskleri yayından önce yakalamak. Bulgu varsa
 * site YAYINLANAMAZ — klinik metni düzeltir; bulgu yoksa da yayın klinik
 * sahibinin açık onayıyla olur (docs/gorev-7-site-uretimi.md).
 */

const RULES = [
  { id: 'garanti', re: /garanti(?:li|si|ler|dir)?\b|güvence(?:si)? (?:veriyoruz|altında sonuç)/i, why: 'Sonuç garantisi verilemez.' },
  { id: 'kesin', re: /kesin (?:sonuç|çözüm|etki)|%\s?100|yüzde yüz|tam (?:başarı|sonuç)/i, why: 'Kesin/yüzde yüz sonuç iddiası.' },
  { id: 'kalici', re: /kalıcı (?:çözüm|sonuç|kurtul)|sonuç\w* kalıcı|ömür boyu|sonsuza (?:dek|kadar)/i, why: 'Kalıcılık iddiası.' },
  { id: 'tedavi', re: /tedavi (?:eder|ediyoruz|edilir)|iyileştir(?:ir|iyoruz)|şifa|hastalığ\w* (?:son|bitir)/i, why: 'Tedavi/iyileştirme vaadi.' },
  { id: 'ustunluk', re: /\ben iyi(?:si)?\b|\bbir numara|\btek adres|türkiye'?nin (?:en|1|bir)|rakipsiz|eşsiz sonuç/i, why: 'Üstünlük/kıyaslama iddiası.' },
  { id: 'acisiz', re: /acısız|ağrısız|hiç acı|yan etkisiz|risksiz|hiçbir (?:yan etki|risk)/i, why: 'Risk/yan etki olmadığı iddiası.' },
  { id: 'oncesi_sonrasi', re: /öncesi\s*[\/-]?\s*sonrası|before\s*\/?\s*after/i, why: 'Öncesi/sonrası karşılaştırması (görsel/iddia) hukukçu teyidi olmadan kullanılmaz.' },
  { id: 'mucize', re: /mucize|sihirli|anında (?:sonuç|gençleş|zayıfla)|bir seansta (?:kurtul|sonuç)/i, why: 'Abartılı/mucizevi sonuç iddiası.' },
  { id: 'aciliyet', re: /son (?:şans|fırsat)|kaçırma(?:yın)?|acele edin|sınırlı kontenjan/i, why: 'Baskı/aciliyet yaratan ifade.' }
];

/** metin → [{ id, why, match }] */
function scan(text) {
  const t = String(text || '');
  const out = [];
  RULES.forEach(function (r) {
    const m = r.re.exec(t);
    if (m) out.push({ id: r.id, why: r.why, match: m[0] });
  });
  return out;
}

/**
 * İçerik nesnesindeki tüm metinler → [{ field, id, why, match }].
 * field: 'heroTitle' | 'about' | 'services[2].description' | 'faq[1].a' ...
 */
function scanContent(content) {
  const c = content || {};
  const issues = [];
  function add(field, text) { scan(text).forEach(function (i) { issues.push(Object.assign({ field: field }, i)); }); }
  ['heroTitle', 'heroSubtitle', 'about', 'metaDescription', 'ctaLabel'].forEach(function (f) { add(f, c[f]); });
  (c.services || []).forEach(function (s, i) { add('services[' + i + '].description', s.description); });
  (c.faq || []).forEach(function (q, i) { add('faq[' + i + '].q', q.q); add('faq[' + i + '].a', q.a); });
  return issues;
}

module.exports = { RULES, scan, scanContent };
