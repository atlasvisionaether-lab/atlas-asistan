'use strict';

/**
 * Klinik sitesi METNİ — DeepSeek (cyberlionai llm.js) ya da yedek şablon.
 *
 * KURAL: yapay zekâ yalnız tanıtım metni yazar. Fiyat, adres, telefon, çalışma
 * saati, hizmet adı ŞABLONDA veritabanından basılır; modele fiyat/iletişim hiç
 * verilmez, çıktıda da kullanılmaz. Model bilinmeyeni (ödül, yıl, doktor adı,
 * sertifika, hasta sayısı) uyduramaz — yalnız klinik notlarındaki bilgiyi kullanır.
 *
 * Flash katmanının çıktı tavanı 1500 token: metin iki paralel çağrıya bölünür
 * (1: hero + hakkımızda + hizmetler, 2: SSS). Çıktı katı şemaya göre doğrulanır
 * ve kırpılır; şema dışı alan atılır, eksik alan yedek metinle dolar.
 */

const llm = require('../../../cyberlionai/api/_lib/llm.js');

const LIMITS = { heroTitle: 70, heroSubtitle: 170, about: 650, ctaLabel: 26, metaDescription: 155, serviceDesc: 140, q: 90, a: 260 };
const MAX_SERVICES = 12;
const MAX_FAQ = 5;

function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').replace(/[<>]/g, '').trim();
  if (t.length <= n) return t;
  /* Kelime ortasından kesme; son boşluktan kes ve üç nokta koy. */
  const cut = t.slice(0, n - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:\s]+$/, '') + '…';
}

function norm(s) { return String(s || '').toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim(); }

const RULES = [
  'Türkçe yaz; sıcak, güven veren, profesyonel bir dil kullan. "Siz" diye hitap et.',
  'YALNIZCA verilen bilgileri kullan. Ödül, kuruluş yılı, doktor/uzman adı, sertifika, hasta/müşteri sayısı, marka, cihaz modeli UYDURMA.',
  'Fiyat, indirim, telefon, adres, çalışma saati YAZMA (bunlar sayfada ayrıca gösterilir).',
  'Sağlık tanıtım mevzuatına uy: sonuç garantisi, "kesin", "%100", "kalıcı", "en iyi", "acısız", "risksiz", "mucize", tedavi/iyileştirme vaadi, öncesi/sonrası karşılaştırması ve aciliyet ("son fırsat", "kaçırmayın") YASAK.',
  'Hizmetleri abartmadan, ne olduğunu ve randevu sürecini anlatarak tanıt. Sonuçlar kişiden kişiye değişebilir.',
  'Yalnız istenen JSON nesnesini yaz; açıklama, markdown, kod bloğu yok.'
];

function facts(name, info, services) {
  const i = info || {};
  return [
    'Klinik adı: ' + name,
    'Şehir/ilçe: ' + ([i.district, i.city].filter(Boolean).join(', ') || '-'),
    'Klinik sahibinin notları (hakkımızda için tek bilgi kaynağı): ' + (i.aboutNotes ? String(i.aboutNotes).slice(0, 1500) : '(not yok — genel ve kısa yaz)'),
    'Hizmetler (adları AYNEN kullan): ' + services.map(function (s) { return s.name + (s.duration_min ? ' (' + s.duration_min + ' dk)' : ''); }).join('; ')
  ].join('\n');
}

function promptMain(name, info, services) {
  return {
    system: 'Bir güzellik/estetik kliniğinin web sitesi için metin yazan deneyimli bir metin yazarısın.\nKURALLAR:\n- ' + RULES.join('\n- '),
    user: facts(name, info, services) + '\n\nŞu JSON nesnesini üret:\n{"heroTitle": "≤' + LIMITS.heroTitle + ' karakter, kliniği anlatan başlık",' +
      ' "heroSubtitle": "≤' + LIMITS.heroSubtitle + ' karakter", "about": "≤' + LIMITS.about + ' karakter, 2 kısa paragraf, \\n\\n ile ayrılmış",' +
      ' "ctaLabel": "≤' + LIMITS.ctaLabel + ' karakter randevu çağrısı", "metaDescription": "≤' + LIMITS.metaDescription + ' karakter",' +
      ' "services": [{"name": "verilen hizmet adı", "description": "≤' + LIMITS.serviceDesc + ' karakter"}]}'
  };
}

function promptFaq(name, info, services) {
  return {
    system: 'Bir güzellik/estetik kliniğinin web sitesi için sık sorulan sorular yazıyorsun.\nKURALLAR:\n- ' + RULES.join('\n- ') +
      '\n- Sorular randevu, hazırlık, süreç, ulaşım ve iletişim kanalları hakkında olsun; tıbbi tavsiye verme, "uzmanımız size özel bilgi verir" de.',
    user: facts(name, info, services) + '\n\nŞu JSON nesnesini üret (' + MAX_FAQ + ' soru):\n{"faq": [{"q": "≤' + LIMITS.q + ' karakter", "a": "≤' + LIMITS.a + ' karakter"}]}'
  };
}

/** Model çıktısından ilk JSON nesnesi (kod bloğu/ön söz olsa da). */
function parseJson(text) {
  const t = String(text || '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch (e) { return null; }
}

/** Yedek metin: yapay zekâ yoksa/düştüyse. Uydurma bilgi içermez. */
function fallback(name, info, services) {
  const place = [info && info.district, info && info.city].filter(Boolean).join(', ');
  return {
    heroTitle: clip(name + (place ? ' · ' + place : ''), LIMITS.heroTitle),
    heroSubtitle: 'Randevunuzu dakikalar içinde oluşturun; sorularınızı 7/24 yanıtlıyoruz.',
    about: clip(info && info.aboutNotes ? info.aboutNotes : name + ', size özenli ve güler yüzlü bir hizmet sunmak için burada. Hizmetlerimiz ve uygun randevu saatleri hakkında bize her an yazabilirsiniz.', LIMITS.about),
    ctaLabel: 'Randevu alın',
    metaDescription: clip(name + (place ? ', ' + place : '') + ' — hizmetler, fiyatlar ve online randevu.', LIMITS.metaDescription),
    services: services.slice(0, MAX_SERVICES).map(function (s) { return { name: s.name, description: '' }; }),
    faq: [
      { q: 'Nasıl randevu alabilirim?', a: 'Sayfadaki mesaj kanallarından bize yazmanız yeterli; uygun saatleri hemen paylaşıyoruz.' },
      { q: 'Mesajlarıma ne zaman dönüş yapılıyor?', a: 'Asistanımız mesajlarınızı 7/24 yanıtlar; gerektiğinde ekibimiz konuşmayı devralır.' },
      { q: 'Randevumu değiştirebilir miyim?', a: 'Elbette. Bize yazarak randevunuzu değiştirebilir ya da iptal edebilirsiniz.' }
    ],
    source: 'fallback'
  };
}

/** Model + yedek → şemaya uygun, kırpılmış içerik. Hizmet adları veritabanındakiyle aynı. */
function normalize(main, faq, name, info, services) {
  const fb = fallback(name, info, services);
  const m = main && typeof main === 'object' ? main : {};
  const byName = {};
  (Array.isArray(m.services) ? m.services : []).forEach(function (s) {
    if (s && typeof s.name === 'string') byName[norm(s.name)] = s.description;
  });
  const faqList = faq && Array.isArray(faq.faq) ? faq.faq : [];
  const out = {
    heroTitle: clip(m.heroTitle || fb.heroTitle, LIMITS.heroTitle),
    heroSubtitle: clip(m.heroSubtitle || fb.heroSubtitle, LIMITS.heroSubtitle),
    about: String(m.about || fb.about).split(/\n{2,}/).map(function (p) { return clip(p, LIMITS.about); }).filter(Boolean).slice(0, 3).join('\n\n').slice(0, LIMITS.about + 40),
    ctaLabel: clip(m.ctaLabel || fb.ctaLabel, LIMITS.ctaLabel),
    metaDescription: clip(m.metaDescription || fb.metaDescription, LIMITS.metaDescription),
    services: services.slice(0, MAX_SERVICES).map(function (s) { return { name: s.name, description: clip(byName[norm(s.name)] || '', LIMITS.serviceDesc) }; }),
    faq: (faqList.length ? faqList : fb.faq).filter(function (x) { return x && x.q && x.a; }).slice(0, MAX_FAQ)
      .map(function (x) { return { q: clip(x.q, LIMITS.q), a: clip(x.a, LIMITS.a) }; }),
    source: main || faqList.length ? 'ai' : 'fallback'
  };
  return out;
}

async function ask(p) {
  let text = '';
  const r = await llm.streamChat({ tier: 'flash', system: p.system, messages: [{ role: 'user', content: p.user }], onDelta: function (d) { text += d; } });
  if (r && r.finishReason === 'max_tokens') console.warn('site-content: max_tokens');
  return parseJson(text);
}

/** { content, source:'ai'|'fallback', error? } — hiçbir durumda fırlatmaz. */
async function generate(name, info, services) {
  if (!llm.isConfigured()) return normalize(null, null, name, info, services);
  const results = await Promise.allSettled([ask(promptMain(name, info, services)), ask(promptFaq(name, info, services))]);
  const main = results[0].status === 'fulfilled' ? results[0].value : null;
  const faq = results[1].status === 'fulfilled' ? results[1].value : null;
  if (!main) console.warn('site-content: main_failed (' + (results[0].reason && results[0].reason.code || 'parse') + ')');
  return normalize(main, faq, name, info, services);
}

/** Panelde elle düzenlenen içeriği aynı şemaya ve sınırlara indirger. */
function sanitizeEdited(input, services) {
  return Object.assign(normalize(input, input, '', {}, services), { source: 'edited' });
}

module.exports = { generate, normalize, sanitizeEdited, fallback, parseJson, promptMain, promptFaq, LIMITS, MAX_FAQ, MAX_SERVICES };
