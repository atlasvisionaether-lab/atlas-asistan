'use strict';

/**
 * Bilgi tabanı (data/knowledge.json) üzerinde puanlama: asistan ucu ve
 * iletişim ucunun önerilen cevap taslağı AYNI mantığı kullanıyor. Kopya
 * olsaydı biri ayarlanıp öteki unutulurdu ve asistanın verdiği cevapla
 * ekibe önerilen taslak ayrışırdı.
 *
 * Saf fonksiyonlar: ağ yok, durum yok, rastgelelik yok.
 */

const KB = require('../../data/knowledge.json');

/** Küçük harf + Türkçe karakter sadeleştirme. */
function normalize(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/İ/g, 'i').replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9@.\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Bir anahtar kelime mesajda var mı.
 * Çok kelimeli ifade: sadeleşmiş metnin içinde aranır.
 * Tek kelime: bir sözcüğün başında aranır (Türkçe ekler). 3 harf ve daha kısa
 * kelime yalnızca birebir eşleşir: "pro" "protokol"ü, "tls" başka bir şeyi
 * yakalamasın.
 */
function hasKeyword(normalized, words, keyword) {
  if (keyword.indexOf(' ') !== -1) return (' ' + normalized + ' ').indexOf(' ' + keyword) !== -1;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (keyword.length <= 3 ? w === keyword : w.indexOf(keyword) === 0) return true;
  }
  return false;
}

/** Bir niyetin puanı (0–1). */
function scoreIntent(normalized, words, intent) {
  let miss = 1;
  ['strong', 'weak'].forEach(function (kind) {
    const weight = KB.weights[kind];
    (intent.keywords[kind] || []).forEach(function (k) {
      if (hasKeyword(normalized, words, k)) miss *= (1 - weight);
    });
  });
  return 1 - miss;
}

/**
 * En iyi niyet. Eşitlikte knowledge.json'daki SIRA kazanır, böylece sonuç
 * deterministik kalır.
 */
function classify(message) {
  const normalized = normalize(message);
  const words = normalized.split(' ').filter(Boolean);
  let best = null, bestScore = 0;
  Object.keys(KB.intents).forEach(function (id) {
    const s = scoreIntent(normalized, words, KB.intents[id]);
    if (s > bestScore) { best = id; bestScore = s; }
  });
  return { intent: best, score: Math.round(bestScore * 100) / 100 };
}

/**
 * Bir niyetin kanonik cevabını düz metin olarak verir (e-posta gövdesi için):
 * paragraf ayırıcısı '|' satır sonuna, kod bloğu kendi satırına.
 */
function answerText(id, lang) {
  const def = KB.intents[id];
  const entry = def && (def[lang] || def.tr);
  if (!entry) return null;
  const parts = [entry.a.split('|').join('\n\n')];
  if (entry.code) parts.push(entry.code);
  if (entry.a2) parts.push(entry.a2.split('|').join('\n\n'));
  return parts.join('\n\n');
}

/**
 * Bir mesaj dizisinde en SON gerçek konuyu bulur. Her mesaj ayrı puanlanıyor
 * ve 'contact' (uzman isteme) atlanıyor: uzmana devir mesajının kendisi hep
 * 'contact' çıkar ve asıl konuyu (ör. "fiyat ne kadar") gölgelerdi.
 * Eşiği geçen konu yoksa null.
 */
function lastTopic(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const c = classify(list[i]);
    if (c.intent && c.intent !== 'contact' && c.score >= KB.threshold) return c.intent;
  }
  return null;
}

module.exports = { KB, normalize, hasKeyword, scoreIntent, classify, answerText, lastTopic };
