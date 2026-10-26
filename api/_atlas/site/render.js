'use strict';

/**
 * Klinik sitesi HTML'i — tek dosya, satır içi CSS, JavaScript YOK.
 *
 * Şablonlar (THEMES): nebula · aurora · eclipse · rose — hepsi uzay/cam dili;
 * yıldız alanı CSS (WebGL yok: klinik sitesi her telefonda hızlı açılmalı).
 * Kliniğin seçtiği vurgu rengi temanın vurgusunu ezer.
 *
 * GÜVENLİK: klinikten gelen HER değer esc() ile kaçışlanır; görsel yolu, telefon,
 * Instagram/Telegram adı katı biçimle doğrulanır (değilse basılmaz). Sayfa
 * /api/atlas-site-render'da sıkı CSP ile sunulur (betik yok, yalnız kendi
 * görsel kovası ve Google Fonts).
 *
 * DOĞRULUK: fiyat, süre, adres, telefon, saat VERİTABANINDAN; tanıtım metni
 * content'ten (yapay zekâ ya da klinik düzenlemesi, klinik onaylı).
 */

const THEMES = {
  nebula: { label: 'Nebula', accent: '#fbbf24', accent2: '#22d3ee', bg: '#05030f', n1: 'rgba(109,40,217,.55)', n2: 'rgba(14,116,144,.42)', n3: 'rgba(190,24,93,.18)', layout: 'center' },
  aurora: { label: 'Aurora', accent: '#2dd4bf', accent2: '#a3e635', bg: '#020b10', n1: 'rgba(13,148,136,.5)', n2: 'rgba(56,189,248,.35)', n3: 'rgba(132,204,22,.16)', layout: 'split' },
  eclipse: { label: 'Eclipse', accent: '#e9c46a', accent2: '#cbd5e1', bg: '#030303', n1: 'rgba(120,90,30,.35)', n2: 'rgba(80,80,90,.28)', n3: 'rgba(233,196,106,.08)', layout: 'eclipse' },
  rose: { label: 'Rose', accent: '#f9a8d4', accent2: '#fde68a', bg: '#0d0410', n1: 'rgba(219,39,119,.42)', n2: 'rgba(124,58,237,.35)', n3: 'rgba(251,191,36,.12)', layout: 'center' }
};

const PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z0-9-]{3,60}\.(?:jpg|png|webp)$/;
const IG_RE = /^[A-Za-z0-9._]{1,30}$/;
const TG_RE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
const HEX_RE = /^#[0-9a-f]{6}$/;

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/** "0532 123 45 67" / "+90 532…" → "+905321234567" | null */
function phoneE164(p) {
  const d = String(p || '').replace(/[^\d+]/g, '');
  if (/^\+\d{10,15}$/.test(d)) return d;
  if (/^0\d{10}$/.test(d)) return '+90' + d.slice(1);
  if (/^5\d{9}$/.test(d)) return '+90' + d;
  return null;
}
function phonePretty(e164) {
  const m = /^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(e164 || '');
  return m ? '0' + m[1] + ' ' + m[2] + ' ' + m[3] + ' ' + m[4] : e164;
}

function price(p) {
  if (p === null || p === undefined || p === '') return null;
  const n = Number(String(p).replace(',', '.'));
  if (Number.isFinite(n) && String(p).trim() !== '') return n > 0 ? '₺' + n.toLocaleString('tr-TR', { maximumFractionDigits: 0 }) : null;
  return String(p).slice(0, 30);
}

function imgUrl(base, path) { return PATH_RE.test(String(path || '')) ? base + '/' + path : null; }

function para(text) {
  return String(text || '').split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
}

/**
 * site: { name, subdomain, template, accent, info, logo_path, photos }
 * content: normalize edilmiş metin; services: [{ name, price, duration_min }]
 * opts: { storageBase, channels: { telegram: '@bot', instagram: '@hesap' }, canonicalBase, year }
 */
function render(site, content, services, opts) {
  const o = opts || {};
  const t = THEMES[site.template] || THEMES.nebula;
  const accent = HEX_RE.test(String(site.accent || '')) ? site.accent : t.accent;
  const info = site.info || {};
  const c = content || {};
  const name = String(site.name || 'Klinik');
  const place = [info.district, info.city].filter(Boolean).join(', ');
  const tel = phoneE164(info.phone);
  const wa = tel && info.whatsapp !== false ? 'https://wa.me/' + tel.slice(1) : null;
  const igName = String((o.channels && o.channels.instagram) || info.instagram || '').replace(/^@/, '');
  const ig = IG_RE.test(igName) ? 'https://instagram.com/' + igName : null;
  const tgName = String((o.channels && o.channels.telegram) || '').replace(/^@/, '');
  const tg = TG_RE.test(tgName) ? 'https://t.me/' + tgName : null;
  const primary = wa ? { href: wa, label: c.ctaLabel || 'WhatsApp’tan yazın' } : tg ? { href: tg, label: c.ctaLabel || 'Telegram’dan yazın' } : tel ? { href: 'tel:' + tel, label: 'Hemen arayın' } : ig ? { href: ig, label: 'Instagram’dan yazın' } : null;
  const logo = imgUrl(o.storageBase, site.logo_path);
  const photos = (site.photos || []).map(function (p) { return { url: imgUrl(o.storageBase, p && p.path), alt: (p && p.alt) || name }; }).filter(function (p) { return p.url; }).slice(0, 12);
  const canonical = (o.canonicalBase || 'https://' + site.subdomain + '.atlasasistan.com') + '/';
  const mapUrl = info.address ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([name, info.address, place].filter(Boolean).join(' ')) : null;
  const svc = services.map(function (s) {
    const d = (c.services || []).find(function (x) { return x.name === s.name; });
    return { name: s.name, desc: d ? d.description : '', price: price(s.price), dur: s.duration_min ? Math.round(s.duration_min) + ' dk' : null };
  });

  const ld = {
    '@context': 'https://schema.org', '@type': 'BeautySalon', name: name, url: canonical,
    description: c.metaDescription || undefined, telephone: tel || undefined,
    image: (photos[0] && photos[0].url) || logo || undefined,
    address: info.address ? { '@type': 'PostalAddress', streetAddress: info.address, addressLocality: info.district || info.city || undefined, addressRegion: info.city || undefined, addressCountry: 'TR' } : undefined
  };
  const ldJson = JSON.stringify(ld).replace(/</g, '\\u003c');

  /* İki sütunlu düzen fotoğrafla tasarlandı; fotoğraf yoksa ortalı düzene geçer. */
  const layout = t.layout === 'split' && !photos.length ? 'center' : t.layout;
  const heroVisual = layout === 'split'
    ? '<div class="hero-visual glass">' + (photos[0] ? '<img src="' + esc(photos[0].url) + '" alt="' + esc(photos[0].alt) + '" loading="eager">' : '<div class="monogram">' + esc(name.slice(0, 1)) + '</div>') + '</div>'
    : '';
  const eclipse = layout === 'eclipse' ? '<div class="eclipse" aria-hidden="true"></div>' : '';

  return '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(name + (place ? ' | ' + place : '')) + '</title>' +
    '<meta name="description" content="' + esc(c.metaDescription || '') + '">' +
    '<link rel="canonical" href="' + esc(canonical) + '">' +
    '<meta property="og:title" content="' + esc(name) + '"><meta property="og:description" content="' + esc(c.metaDescription || '') + '">' +
    '<meta property="og:type" content="website"><meta property="og:url" content="' + esc(canonical) + '">' +
    (ld.image ? '<meta property="og:image" content="' + esc(ld.image) + '">' : '') +
    '<meta name="theme-color" content="' + t.bg + '">' +
    (logo ? '<link rel="icon" href="' + esc(logo) + '">' : '') +
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Manrope:wght@400;500;600;700&display=swap">' +
    '<script type="application/ld+json">' + ldJson + '</script>' +
    '<style>' + css(t, accent) + '</style></head><body class="t-' + esc(site.template || 'nebula') + ' l-' + layout + '">' +
    '<div class="sky" aria-hidden="true"></div>' +
    '<header class="bar"><div class="wrap bar-in"><a class="brand" href="#top">' +
      (logo ? '<img src="' + esc(logo) + '" alt="' + esc(name) + ' logosu" width="40" height="40">' : '<span class="mono">' + esc(name.slice(0, 1)) + '</span>') +
      '<span>' + esc(name) + '</span></a><nav aria-label="Sayfa"><a href="#hizmetler">Hizmetler</a><a href="#hakkimizda">Hakkımızda</a><a href="#sss">SSS</a><a href="#iletisim">İletişim</a></nav>' +
      (primary ? '<a class="btn small" href="' + esc(primary.href) + '" rel="noopener">' + esc(primary.label) + '</a>' : '') +
    '</div></header>' +
    '<main id="top">' +
    '<section class="hero"><div class="wrap hero-in">' + eclipse + '<div class="hero-text">' +
      (place ? '<span class="kicker">' + esc(place) + '</span>' : '') +
      '<h1>' + esc(c.heroTitle || name) + '</h1><p class="lead">' + esc(c.heroSubtitle || '') + '</p>' +
      '<div class="cta">' + (primary ? '<a class="btn" href="' + esc(primary.href) + '" rel="noopener">' + esc(primary.label) + '</a>' : '') +
      '<a class="btn ghost" href="#hizmetler">Hizmetlerimiz</a></div></div>' + heroVisual + '</div></section>' +
    (svc.length ? '<section id="hizmetler"><div class="wrap"><h2>Hizmetlerimiz</h2><div class="grid">' + svc.map(function (s) {
      return '<article class="card glass"><h3>' + esc(s.name) + '</h3>' + (s.desc ? '<p>' + esc(s.desc) + '</p>' : '') +
        '<div class="meta">' + (s.price ? '<span class="price">' + esc(s.price) + '</span>' : '<span class="muted">Fiyat için bize yazın</span>') +
        (s.dur ? '<span class="muted">' + esc(s.dur) + '</span>' : '') + '</div></article>';
    }).join('') + '</div><p class="note">Fiyatlar bilgilendirme amaçlıdır; kesin bilgi için bize yazın.</p></div></section>' : '') +
    '<section id="hakkimizda"><div class="wrap about' + (photos.length ? '' : ' solo') + '"><div class="glass pad"><h2>Hakkımızda</h2>' + para(c.about) + '</div>' +
      (photos.length ? '<div class="gallery">' + photos.map(function (p) { return '<img src="' + esc(p.url) + '" alt="' + esc(p.alt) + '" loading="lazy">'; }).join('') + '</div>' : '') +
    '</div></section>' +
    ((c.faq || []).length ? '<section id="sss"><div class="wrap narrow"><h2>Sık sorulan sorular</h2>' + c.faq.map(function (q) {
      return '<details class="glass"><summary>' + esc(q.q) + '</summary><p>' + esc(q.a) + '</p></details>';
    }).join('') + '</div></section>' : '') +
    '<section id="iletisim"><div class="wrap"><h2>İletişim</h2><div class="grid contact">' +
      (info.address ? '<div class="card glass"><h3>Adres</h3><p>' + esc(info.address) + (place ? '<br>' + esc(place) : '') + '</p>' + (mapUrl ? '<a href="' + esc(mapUrl) + '" rel="noopener">Haritada aç →</a>' : '') + '</div>' : '') +
      (tel ? '<div class="card glass"><h3>Telefon</h3><p><a href="tel:' + esc(tel) + '">' + esc(phonePretty(tel)) + '</a></p>' + (wa ? '<a href="' + esc(wa) + '" rel="noopener">WhatsApp’tan yazın →</a>' : '') + '</div>' : '') +
      (info.hours ? '<div class="card glass"><h3>Çalışma saatleri</h3><p class="pre">' + esc(info.hours) + '</p></div>' : '') +
      (ig || tg ? '<div class="card glass"><h3>Mesaj</h3><p>' + (ig ? '<a href="' + esc(ig) + '" rel="noopener">Instagram @' + esc(igName) + '</a><br>' : '') + (tg ? '<a href="' + esc(tg) + '" rel="noopener">Telegram @' + esc(tgName) + '</a>' : '') + '</p><p class="muted">Asistanımız 7/24 yanıtlar.</p></div>' : '') +
    '</div></div></section></main>' +
    '<footer><div class="wrap foot"><span>© ' + esc(o.year || new Date().getFullYear()) + ' ' + esc(name) + '</span>' +
      '<span class="muted">Bu sayfadaki bilgiler tanıtım amaçlıdır, tıbbi tavsiye değildir; sonuçlar kişiden kişiye değişebilir.</span>' +
      '<a class="made" href="https://atlasasistan.com" rel="noopener">Atlas Asistan ile hazırlandı</a></div></footer>' +
    '</body></html>';
}

function css(t, accent) {
  return ':root{--bg:' + t.bg + ';--ink:#f5f2ff;--muted:#a7a1c4;--accent:' + accent + ';--accent2:' + t.accent2 + ';--glass:rgba(255,255,255,.055);--edge:rgba(255,255,255,.12);' +
    '--serif:"Fraunces","Iowan Old Style",Georgia,serif;--sans:"Manrope","Segoe UI",system-ui,sans-serif}' +
    '*{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth}body{background:var(--bg);color:var(--ink);font:400 16px/1.65 var(--sans);overflow-x:hidden}' +
    '.sky{position:fixed;inset:0;z-index:-1;pointer-events:none;' +
      'background:radial-gradient(900px 620px at 85% -10%,' + t.n1 + ',transparent 62%),radial-gradient(800px 600px at -10% 105%,' + t.n2 + ',transparent 60%),radial-gradient(600px 420px at 45% 55%,' + t.n3 + ',transparent 70%),var(--bg)}' +
    '.sky::before,.sky::after{content:"";position:absolute;inset:-50%;background-image:' +
      'radial-gradient(1.2px 1.2px at 20px 30px,#fff,transparent),radial-gradient(1px 1px at 120px 80px,#fff,transparent),radial-gradient(1.4px 1.4px at 200px 160px,#fde68a,transparent),' +
      'radial-gradient(1px 1px at 300px 40px,#a5f3fc,transparent),radial-gradient(1px 1px at 380px 220px,#fff,transparent),radial-gradient(1.3px 1.3px at 60px 260px,#fff,transparent);' +
      'background-size:420px 300px;opacity:.55;animation:drift 160s linear infinite}' +
    '.sky::after{background-size:620px 440px;opacity:.35;animation-duration:240s;animation-direction:reverse}' +
    '@keyframes drift{to{transform:translate3d(-420px,-300px,0)}}' +
    '.wrap{max-width:1120px;margin:0 auto;padding:0 22px}.narrow{max-width:820px}' +
    'a{color:var(--accent)}h1,h2,h3{font-family:var(--serif);font-weight:600;letter-spacing:-.01em;line-height:1.15}' +
    'h2{font-size:clamp(1.7rem,3.6vw,2.4rem);margin-bottom:26px;background:linear-gradient(95deg,#fff,var(--accent));-webkit-background-clip:text;background-clip:text;color:transparent}' +
    'section{padding:84px 0}.muted{color:var(--muted)}.pre{white-space:pre-line}' +
    '.glass{position:relative;background:linear-gradient(155deg,rgba(255,255,255,.08),rgba(255,255,255,.02)),rgba(10,8,24,.45);-webkit-backdrop-filter:blur(16px) saturate(140%);backdrop-filter:blur(16px) saturate(140%);border-radius:20px;box-shadow:0 30px 70px -36px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.08)}' +
    '.glass::before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;pointer-events:none;background:linear-gradient(135deg,var(--accent),rgba(255,255,255,.12) 30%,rgba(203,213,225,.18) 65%,var(--accent2));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;opacity:.55}' +
    '.bar{position:sticky;top:0;z-index:10;background:rgba(5,3,15,.55);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,.07)}' +
    '.bar-in{display:flex;align-items:center;gap:20px;height:68px}.brand{display:flex;align-items:center;gap:10px;color:var(--ink);text-decoration:none;font-family:var(--serif);font-weight:600;font-size:1.15rem;margin-right:auto}' +
    '.brand img{width:40px;height:40px;object-fit:contain;border-radius:10px}.mono{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;font-family:var(--serif);color:#120a00;background:radial-gradient(circle at 32% 28%,#fff,var(--accent) 55%,#7c2d12);box-shadow:0 0 20px color-mix(in srgb,var(--accent) 50%,transparent)}' +
    '.bar nav{display:flex;gap:22px}.bar nav a{color:var(--muted);text-decoration:none;font-weight:600;font-size:.92rem}.bar nav a:hover{color:var(--ink)}' +
    '.btn{display:inline-flex;align-items:center;justify-content:center;padding:13px 26px;border-radius:999px;font-weight:700;text-decoration:none;color:#120a00;background:linear-gradient(95deg,#fff7d6,var(--accent));box-shadow:0 12px 34px -12px var(--accent);transition:transform .3s,box-shadow .3s}' +
    '.btn:hover{transform:translateY(-2px)}.btn.ghost{color:var(--ink);background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 1px var(--edge)}.btn.small{padding:9px 18px;font-size:.88rem}' +
    '.hero{padding:110px 0 90px}.hero-in{position:relative;display:grid;gap:40px;align-items:center;text-align:center;justify-items:center}' +
    '.l-split .hero-in{grid-template-columns:1.1fr .9fr;text-align:left;justify-items:start}' +
    '.kicker{display:inline-block;margin-bottom:22px;padding:8px 16px;border-radius:999px;font-size:.74rem;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,transparent);border:1px solid color-mix(in srgb,var(--accent) 35%,transparent)}' +
    'h1{font-size:clamp(2.3rem,6vw,4rem);max-width:16ch;text-shadow:0 2px 40px rgba(0,0,0,.5)}.l-split h1{max-width:none}' +
    '.lead{margin:22px auto 34px;max-width:58ch;font-size:1.12rem;color:var(--muted)}.l-split .lead{margin-left:0}' +
    '.cta{display:flex;flex-wrap:wrap;gap:14px;justify-content:center}.l-split .cta{justify-content:flex-start}' +
    '.hero-visual{width:100%;aspect-ratio:4/5;overflow:hidden;padding:10px}.hero-visual img{width:100%;height:100%;object-fit:cover;border-radius:14px;display:block}' +
    '.monogram{width:100%;height:100%;display:grid;place-items:center;font-family:var(--serif);font-size:8rem;color:var(--accent)}' +
    '.eclipse{position:absolute;top:-70px;left:50%;width:min(520px,90vw);aspect-ratio:1;transform:translateX(-50%);z-index:-1;border-radius:50%;' +
      'background:radial-gradient(circle,var(--bg) 58%,transparent 59%);box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 70%,transparent),0 0 60px 6px color-mix(in srgb,var(--accent) 40%,transparent),0 0 160px 30px color-mix(in srgb,var(--accent) 16%,transparent)}' +
    '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px}' +
    '.card{padding:24px}.card h3{font-size:1.2rem;margin-bottom:8px}.card p{color:var(--muted);font-size:.95rem}' +
    '.meta{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.08)}' +
    '.price{font-family:var(--serif);font-size:1.35rem;font-weight:600;color:var(--accent)}.note{margin-top:16px;font-size:.82rem;color:var(--muted)}' +
    '.about{display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:start}.pad{padding:32px}.pad p{color:var(--muted);margin-top:12px}' +
    '.about.solo{grid-template-columns:1fr;max-width:820px}.gallery{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.gallery img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:16px;box-shadow:0 20px 50px -30px #000}' +
    'details{margin-bottom:12px;padding:18px 22px}summary{cursor:pointer;font-weight:700}details p{color:var(--muted);margin-top:10px}' +
    'footer{padding:36px 0;border-top:1px solid rgba(255,255,255,.07)}.foot{display:flex;flex-wrap:wrap;gap:10px 24px;align-items:center;font-size:.85rem}.foot .made{margin-left:auto;color:var(--muted)}' +
    '@media(max-width:860px){.bar nav{display:none}.l-split .hero-in,.about{grid-template-columns:1fr}.l-split .hero-in{text-align:center;justify-items:center}.l-split .cta{justify-content:center}.l-split .lead{margin-left:auto}.hero{padding:70px 0 60px}section{padding:60px 0}}' +
    '@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.sky::before,.sky::after{animation:none}.btn{transition:none}}' +
    '@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.glass{background:rgba(12,10,26,.94)}}';
}

module.exports = { render, THEMES, esc, phoneE164, price, PATH_RE };
