'use strict';

/**
 * VIP çok sayfalı site — hizmet, bölge ve blog sayfalarının METNİ.
 *
 * Aynı kurallar (content.js): yalnız verilen bilgi; fiyat/telefon/adres yok;
 * sağlık tanıtım yasakları; çıktı katı şema. Her sayfa AYRI istekte üretilir
 * (Vercel 60 sn sınırı; panel sırayla çağırır).
 *
 * Kapı sayfası (doorway) önlemi: bölge sayfası yalnız kliniğin seçtiği
 * bölge + hizmet için ve kliniğin O BÖLGEYE ÖZGÜ notuyla (en az 40 karakter)
 * üretilir; model bölge bilgisini yalnız bu nottan alır, uydurmaz.
 */

const llm = require('../../../cyberlionai/api/_lib/llm.js');
const contentLib = require('./content.js');

const MAX_REGIONS = 6;
const REGION_NOTE_MIN = 40;
const RESERVED_SLUGS = new Set(['blog', 'sitemap-xml', 'robots-txt', 's', 'api', 'index']);

const TR = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'İ': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'Ç': 'c', 'Ğ': 'g', 'Ö': 'o', 'Ş': 's', 'Ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' };
function slugify(text, max) {
  return String(text || '').replace(/[çğıİöşüÇĞÖŞÜâîû]/g, function (c) { return TR[c]; }).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max || 70).replace(/-+$/g, '');
}
function serviceSlug(name) { const s = slugify(name, 60); return RESERVED_SLUGS.has(s) || !s ? 'hizmet-' + (s || 'x') : s; }
function regionSlug(region, service) { return slugify(region + ' ' + service, 78); }
function blogSlug(title) { return 'blog-' + slugify(title, 70); }

const LIMITS = { intro: 420, h: 70, p: 900, q: 90, a: 260, meta: 155, title: 80, excerpt: 220 };

function clip(s, n) {
  const t = String(s || '').replace(/[<>]/g, '').replace(/[ \t]+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1), sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:\s]+$/, '') + '…';
}
function cleanSections(list, max) {
  return (Array.isArray(list) ? list : []).filter(function (x) { return x && x.h && x.p; }).slice(0, max)
    .map(function (x) { return { h: clip(x.h, LIMITS.h), p: String(x.p).split(/\n{2,}/).map(function (pp) { return clip(pp, LIMITS.p); }).filter(Boolean).join('\n\n') }; });
}
function cleanFaq(list, max) {
  return (Array.isArray(list) ? list : []).filter(function (x) { return x && x.q && x.a; }).slice(0, max).map(function (x) { return { q: clip(x.q, LIMITS.q), a: clip(x.a, LIMITS.a) }; });
}

const RULES = [
  'Türkçe yaz; sıcak, profesyonel, "siz" diye hitap et.',
  'YALNIZCA verilen bilgileri kullan. Ödül, yıl, doktor/uzman adı, sertifika, sayı, cihaz modeli, istatistik UYDURMA.',
  'Fiyat, indirim, telefon, adres, saat YAZMA (sayfada ayrıca gösterilir).',
  'Sağlık tanıtım mevzuatı: sonuç garantisi, "kesin", "%100", "kalıcı", "en iyi", "acısız", "risksiz", "mucize", tedavi/iyileştirme vaadi, öncesi/sonrası, aciliyet YASAK. Sonuçların kişiden kişiye değiştiğini hatırlat.',
  'Tıbbi tavsiye verme; kişiye özel konular için "uzmanımız size özel bilgi verir" de.',
  'Yalnız istenen JSON nesnesini yaz; markdown/kod bloğu yok.'
];
function system(role) { return role + '\nKURALLAR:\n- ' + RULES.join('\n- '); }
function facts(name, info) {
  const i = info || {};
  return 'Klinik: ' + name + '\nŞehir/ilçe: ' + ([i.district, i.city].filter(Boolean).join(', ') || '-') +
    '\nKlinik notları: ' + (i.aboutNotes ? String(i.aboutNotes).slice(0, 1200) : '(yok)');
}

function promptService(name, info, service) {
  return {
    system: system('Bir güzellik/estetik kliniğinin hizmet sayfası için metin yazıyorsun.'),
    user: facts(name, info) + '\nHizmet: ' + service.name + (service.duration_min ? ' (yaklaşık ' + service.duration_min + ' dk)' : '') +
      '\n\nJSON: {"intro": "≤' + LIMITS.intro + ' karakter giriş", "sections": [3 adet {"h": "başlık", "p": "≤600 karakter"}: "Hizmet nedir?", "Seans nasıl geçer?", "Randevu öncesi bilmeniz gerekenler"],' +
      ' "faq": [3 adet {"q": "…", "a": "…"}], "metaDescription": "≤' + LIMITS.meta + ' karakter"}'
  };
}

function promptRegion(name, info, region) {
  return {
    system: system('Bir güzellik kliniğinin belirli bir semte hitap eden sayfası için metin yazıyorsun. Semt hakkında YALNIZ klinik sahibinin notunu kullan; semtle ilgili başka bilgi (mesafe, durak adı, nüfus, popülerlik) uydurma.'),
    user: facts(name, info) + '\nSemt: ' + region.name + '\nHizmet: ' + region.service + '\nKlinik sahibinin bu semt için notu (ulaşım vb. TEK KAYNAK): ' + String(region.note).slice(0, 600) +
      '\n\nJSON: {"intro": "≤' + LIMITS.intro + ' karakter, ' + region.name + ' bölgesinden gelenlere hitap eden giriş", "sections": [2 adet {"h": "…", "p": "≤600 karakter"}: biri ulaşım/konum (yalnız nottan), biri hizmet ve randevu süreci],' +
      ' "faq": [2 adet {"q": "…", "a": "…"}], "metaDescription": "≤' + LIMITS.meta + ' karakter"}'
  };
}

function promptPost(name, info, services, title) {
  return {
    system: system('Bir güzellik kliniğinin blogu için kısa, bilgilendirici bir rehber yazısı yazıyorsun (yaklaşık 450 kelime).'),
    user: facts(name, info) + '\nKliniğin hizmetleri: ' + services.map(function (s) { return s.name; }).join(', ') + '\nYazı başlığı: ' + title +
      '\n\nJSON: {"title": "≤' + LIMITS.title + ' karakter", "excerpt": "≤' + LIMITS.excerpt + ' karakter özet", "sections": [4 adet {"h": "ara başlık", "p": "≤700 karakter"}], "metaDescription": "≤' + LIMITS.meta + ' karakter"}'
  };
}

function promptTopics(name, info, services) {
  return {
    system: system('Bir güzellik kliniğinin blogu için yazı konusu öneriyorsun. Konular bilgilendirici olsun (bakım ipuçları, randevu hazırlığı, mevsimsel bakım, hizmetin nasıl uygulandığı); tıbbi teşhis/tedavi konusu önerme.'),
    user: facts(name, info) + '\nHizmetler: ' + services.map(function (s) { return s.name; }).join(', ') + '\n\nJSON: {"topics": [6 adet "≤' + LIMITS.title + ' karakter başlık"]}'
  };
}

async function ask(p) {
  if (!llm.isConfigured()) return null;
  let text = '';
  try {
    await llm.streamChat({ tier: 'flash', system: p.system, messages: [{ role: 'user', content: p.user }], onDelta: function (d) { text += d; } });
  } catch (e) {
    console.warn('site-pages: llm_failed (' + (e.code || e.message) + ')');
    return null;
  }
  return contentLib.parseJson(text);
}

/* --- Üreticiler: hiçbiri fırlatmaz; yapay zekâ yoksa uydurmasız yedek döner. --- */

async function generateService(name, info, service) {
  const r = (await ask(promptService(name, info, service))) || {};
  return {
    intro: clip(r.intro || name + ' olarak ' + service.name + ' hizmetimiz hakkında bilgi almak ve randevu oluşturmak için bize yazabilirsiniz.', LIMITS.intro),
    sections: cleanSections(r.sections, 4),
    faq: cleanFaq(r.faq, 4),
    metaDescription: clip(r.metaDescription || service.name + ' — ' + name + ([info && info.district].filter(Boolean).length ? ', ' + info.district : '') + '. Fiyat ve randevu bilgisi.', LIMITS.meta),
    source: r.intro ? 'ai' : 'fallback'
  };
}

async function generateRegion(name, info, region) {
  const r = (await ask(promptRegion(name, info, region))) || {};
  return {
    intro: clip(r.intro || region.name + ' ve çevresinden ' + region.service + ' için ' + name + '’e kolayca ulaşabilirsiniz.', LIMITS.intro),
    sections: cleanSections(r.sections, 3).length ? cleanSections(r.sections, 3) : [{ h: region.name + '’den ulaşım', p: clip(region.note, LIMITS.p) }],
    faq: cleanFaq(r.faq, 3),
    metaDescription: clip(r.metaDescription || region.name + ' ' + region.service + ' — ' + name + '. Randevu ve ulaşım bilgisi.', LIMITS.meta),
    source: r.intro ? 'ai' : 'fallback'
  };
}

async function generatePost(name, info, services, title) {
  const r = (await ask(promptPost(name, info, services, title))) || null;
  if (!r) return null;   // blogda uydurmasız yedek "yazı" yok: üretilemediyse söylenir
  const sections = cleanSections(r.sections, 6);
  if (!sections.length) return null;
  return {
    title: clip(r.title || title, LIMITS.title), excerpt: clip(r.excerpt || '', LIMITS.excerpt),
    sections: sections, metaDescription: clip(r.metaDescription || r.excerpt || '', LIMITS.meta), source: 'ai'
  };
}

async function suggestTopics(name, info, services) {
  const r = (await ask(promptTopics(name, info, services))) || {};
  const list = (Array.isArray(r.topics) ? r.topics : []).map(function (t) { return clip(t, LIMITS.title); }).filter(Boolean).slice(0, 6);
  if (list.length) return list;
  return services.slice(0, 3).map(function (s) { return s.name + ' randevunuza nasıl hazırlanırsınız?'; })
    .concat(['Mevsime göre cilt bakımı: kısa bir rehber', 'İlk ziyaretinizde sizi neler bekliyor?']).slice(0, 6);
}

/** Panelde elle düzenlenen sayfa içeriği → aynı şema/sınırlar. */
function sanitizePage(kind, input) {
  const c = input || {};
  const base = { sections: cleanSections(c.sections, kind === 'blog' ? 6 : 4), metaDescription: clip(c.metaDescription, LIMITS.meta), source: 'edited' };
  if (kind === 'blog') return Object.assign(base, { title: clip(c.title, LIMITS.title), excerpt: clip(c.excerpt, LIMITS.excerpt) });
  return Object.assign(base, { intro: clip(c.intro, LIMITS.intro), faq: cleanFaq(c.faq, 4) });
}

/** Bölge listesi doğrulama → { regions } | { error } */
function cleanRegions(list, serviceNames) {
  const out = [];
  const seen = new Set();
  for (const r of (Array.isArray(list) ? list : []).slice(0, MAX_REGIONS + 1)) {
    const name = clip(r && r.name, 40), service = String((r && r.service) || ''), note = clip(r && r.note, 600);
    if (!name && !note) continue;
    if (!name || name.length < 2) return { error: 'region_name' };
    if (serviceNames.indexOf(service) === -1) return { error: 'region_service' };
    if (note.length < REGION_NOTE_MIN) return { error: 'region_note' };
    const slug = regionSlug(name, service);
    if (seen.has(slug)) return { error: 'region_duplicate' };
    seen.add(slug);
    out.push({ name: name, service: service, note: note, slug: slug });
  }
  if (out.length > MAX_REGIONS) return { error: 'region_limit' };
  return { regions: out };
}

/** Sayfa metnindeki tüm metinler (denetim için) → compliance.scanContent'e uygun biçim. */
function scanShape(kind, c) {
  const x = c || {};
  return {
    heroTitle: x.title, heroSubtitle: x.intro || x.excerpt, metaDescription: x.metaDescription,
    about: (x.sections || []).map(function (s) { return s.h + '\n' + s.p; }).join('\n\n'),
    faq: x.faq || []
  };
}

module.exports = {
  slugify, serviceSlug, regionSlug, blogSlug, cleanRegions, sanitizePage, scanShape,
  generateService, generateRegion, generatePost, suggestTopics,
  promptService, promptRegion, promptPost, MAX_REGIONS, REGION_NOTE_MIN, RESERVED_SLUGS
};
