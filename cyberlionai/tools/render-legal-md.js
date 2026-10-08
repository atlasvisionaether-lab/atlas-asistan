#!/usr/bin/env node
'use strict';

/**
 * legal/*.md → kök dizinde statik yasal sayfalar.
 *
 *   node tools/render-legal-md.js          # yazar
 *   node tools/render-legal-md.js --check  # yalnızca kontrol, çıkış 1 = bayat
 *
 * NEDEN BİR ÜRETİCİ
 *
 * Yasal metnin kaynağı legal/ altındaki Markdown dosyaları; sayfalar onlardan
 * ÜRETİLİR, elle düzenlenmez. Bu depoda derleme adımı yok (düz HTML + Vercel),
 * bu yüzden çıktılar depoya yazılıyor ve `--check` md ile HTML'in ayrışmadığını
 * sınıyor (bkz. tools/legal-md-test.js).
 *
 * Şirket bilgisi md'deki "SATICI BİLGİLERİ" bloğundan DEĞİL, legal-data.js'ten
 * gelir (tek kaynak). md'deki blok ve "Son Güncelleme" satırı gövdeden atılır;
 * ikisi de sayfanın altında standart biçimde yazılır.
 *
 * Satır içi script YOK: CSP hash listesi değişmez. Stil /legal.css'te.
 * Markdown'un yalnızca bu dosyaların kullandığı alt kümesi destekleniyor:
 * #, ##, paragraf, "- " ve "1. " listeleri, **kalın**, e-posta ve https bağlantıları.
 */

const fs = require('fs');
const path = require('path');
const { isletme } = require('../legal-data.js');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'legal');
const GUNCELLEME_TARIHI = '05.10.2026';
const SITE = 'https://www.cyberlionai.com';

/* Sayfa adı → başlık ve açıklama. Başlık h1'den değil buradan: md'deki h1
   BÜYÜK HARF, sekme başlığında okunaklı biçim isteniyor. */
const SAYFALAR = [
  { slug: 'mesafeli-satis-sozlesmesi', title: 'Mesafeli Satış Sözleşmesi',
    description: 'Cyber Lion AI abonelik hizmetinin mesafeli satış sözleşmesi: hizmetin niteliği, KDV dahil fiyatlar, teslimat, cayma hakkı ve abonelik yenileme.' },
  { slug: 'gizlilik-politikasi', title: 'Gizlilik Politikası',
    description: 'Cyber Lion AI hangi verileri topluyor, nasıl kullanıyor ve hangi üçüncü taraflarla paylaşıyor; çerezler ve KVKK haklarınız.' },
  { slug: 'kvkk-aydinlatma-metni', title: 'KVKK Aydınlatma Metni',
    description: '6698 sayılı KVKK kapsamında Cyber Lion AI aydınlatma metni: işlenen veriler, amaçlar, hukuki sebepler, aktarım, saklama süresi ve başvuru.' },
  { slug: 'iade-iptal-politikasi', title: 'İade ve İptal Politikası',
    description: 'Cyber Lion AI abonelik iptali, iade koşulları ve tek seferlik düzeltme hizmetinin ifa süresi ile iptal kuralları.' },
  { slug: 'kullanim-kosullari', title: 'Kullanım Koşulları',
    description: 'Cyber Lion AI güvenlik tarama hizmetinin kullanım koşulları: yetkili tarama, plan sınırları, sorumluluk ve yetkili mahkeme.' },
  { slug: 'teslimat-bilgisi', title: 'Teslimat Bilgisi',
    description: 'Cyber Lion AI dijital hizmet teslimatı: etkinleşme süresi, fatura ve destek. Fiziksel kargo yoktur.' }
];

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/** Satır içi biçim: kaçış → **kalın** → bağlantılar. */
function inline(text) {
  let s = esc(text);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/https:\/\/[^\s<)]+[^\s<).,;:]/g, function (u) {
    return '<a href="' + u + '">' + u.replace(/^https:\/\//, '') + '</a>';
  });
  s = s.replace(/\b[a-z0-9._-]+@cyberlionai\.com\b/g, function (m) {
    return '<a href="mailto:' + m + '">' + m + '</a>';
  });
  return s;
}

/** md'den başlık, gövde bloklarını ayırır; satıcı bloğunu ve tarih satırını atar. */
function parse(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let h1 = null;
  const body = [];
  let inSeller = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (h1 === null && /^# /.test(line)) { h1 = line.slice(2).trim(); continue; }
    if (/^Son Güncelleme:/i.test(line)) continue;
    if (/^SATICI BİLGİLERİ:?$/i.test(line)) { inSeller = true; continue; }
    if (inSeller) { if (line === '') inSeller = false; continue; }
    body.push(line);
  }
  if (!h1) throw new Error('h1 yok');
  return { h1: h1, html: blocks(body) };
}

function blocks(lines) {
  const out = [];
  let para = [];
  let list = null; // { tag, items }
  function flushPara() {
    if (para.length) out.push('<p>' + inline(para.join(' ')) + '</p>');
    para = [];
  }
  function flushList() {
    if (list) out.push('<' + list.tag + '>\n' + list.items.map(function (i) {
      return '  <li>' + inline(i) + '</li>';
    }).join('\n') + '\n</' + list.tag + '>');
    list = null;
  }
  for (const line of lines) {
    let m;
    if (line === '') { flushPara(); flushList(); continue; }
    if ((m = /^## (.+)$/.exec(line))) { flushPara(); flushList(); out.push('<h2>' + inline(m[1]) + '</h2>'); continue; }
    if ((m = /^- (.+)$/.exec(line))) {
      flushPara();
      if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
      list.items.push(m[1]); continue;
    }
    if ((m = /^\d+\. (.+)$/.exec(line))) {
      flushPara();
      if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
      list.items.push(m[1]); continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return out.join('\n');
}

const LOGO = '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">'
  + '<path d="M24 3 L42 9 V23 C42 34 34 41.5 24 45 C14 41.5 6 34 6 23 V9 Z" fill="rgba(212,175,55,.07)" stroke="#d4af37" stroke-width="2.2" stroke-linejoin="round"/>'
  + '<circle cx="24" cy="22" r="6.4" fill="none" stroke="#d4af37" stroke-width="2.2"/></svg>';

function footer() {
  const yasal = SAYFALAR.map(function (p) {
    return '            <li><a href="/' + p.slug + '">' + esc(p.title) + '</a></li>';
  }).join('\n');
  return `  <footer class="site-foot">
    <div class="wrap">
      <div class="fgrid">
        <div>
          <h3>Şirket Bilgileri</h3>
          <ul>
            <li>${esc(isletme.adresKisa)}</li>
            <li>Tel: <a href="${isletme.telefonHref}">${esc(isletme.telefonGoruntu)}</a></li>
            <li>E-posta: <a href="mailto:${isletme.epostaInfo}">${isletme.epostaInfo}</a> / <a href="mailto:${isletme.epostaDestek}">${isletme.epostaDestek}</a></li>
            <li>VKN: ${esc(isletme.vkn)}</li>
          </ul>
        </div>
        <nav aria-label="Yasal">
          <h3>Yasal</h3>
          <ul>
${yasal}
            <li><a href="/pages/on-bilgilendirme-formu">Ön Bilgilendirme Formu</a></li>
            <li><a href="/pages/cerez-politikasi">Çerez Politikası</a></li>
          </ul>
        </nav>
        <div>
          <h3>Ürün</h3>
          <ul>
            <li><a href="/#ozellikler">Özellikler</a></li>
            <li><a href="/#nasil-calisir">Nasıl Çalışır</a></li>
            <li><a href="/odeme?plan=pro">Pro'ya Geç</a></li>
          </ul>
        </div>
        <div>
          <h3>Güvenli Ödeme</h3>
          <p>Ödemeler iyzico güvencesi ile alınmaktadır.</p>
          <div class="iyz"><span class="iyz__mark">iyzico</span><span>ile Öde</span></div>
        </div>
      </div>
      <p class="fcopy">© ${isletme.telifYili} ${esc(isletme.unvan)} - ${esc(isletme.isletmeTuru)}</p>
    </div>
  </footer>`;
}

function render(page, parsed) {
  const url = SITE + '/' + page.slug;
  return `<!DOCTYPE html>
<!-- ÜRETİLMİŞ DOSYA — elle düzenlemeyin. Kaynak: legal/${page.slug}.md
     Yeniden üretmek için: node tools/render-legal-md.js -->
<html lang="tr" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#0a0a0f" />
  <title>${esc(page.title)} | Cyber Lion AI</title>
  <meta name="description" content="${esc(page.description)}" />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="${url}" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Cyber Lion AI" />
  <meta property="og:title" content="${esc(page.title)} | Cyber Lion AI" />
  <meta property="og:description" content="${esc(page.description)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="https://cyberlionai.com/og-image.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;700;800&family=Space+Grotesk:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="icon" href="/favicon-32.png" />
  <link rel="stylesheet" href="/legal.css" />
</head>
<body>
  <header class="site-head">
    <div class="wrap bar">
      <a class="logo" href="/">${LOGO}<span>CYBER LION AI</span></a>
      <a class="back" href="/">Ana Sayfa</a>
    </div>
  </header>

  <main class="wrap legal">
    <article class="prose">
      <h1>${inline(parsed.h1)}</h1>
${parsed.html.split('\n').map(function (l) { return '      ' + l; }).join('\n')}
    </article>

    <aside class="legal-meta" aria-label="Belge bilgileri">
      <p><strong>Son güncelleme:</strong> ${GUNCELLEME_TARIHI}</p>
      <p><strong>${esc(isletme.unvan)} – ${esc(isletme.isletmeTuru)} (Cyber Lion AI)</strong><br />
        ${esc(isletme.adresKisa)}<br />
        VKN ${esc(isletme.vkn)} · ${esc(isletme.vergiDairesi)}<br />
        <a href="mailto:${isletme.epostaDestek}">${isletme.epostaDestek}</a> · <a href="${isletme.telefonHref}">${esc(isletme.telefonGoruntu)}</a></p>
    </aside>
  </main>

${footer()}

  <script src="/mail-links.js" defer></script>
</body>
</html>
`;
}

function main() {
  const check = process.argv.indexOf('--check') !== -1;
  let bayat = false;
  for (const page of SAYFALAR) {
    const src = path.join(SRC, page.slug + '.md');
    const out = path.join(ROOT, page.slug + '.html');
    const html = render(page, parse(fs.readFileSync(src, 'utf8')));
    const once = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
    if (check) {
      if (once !== html) { console.error('Bayat: ' + page.slug + '.html'); bayat = true; }
      continue;
    }
    if (once !== html) fs.writeFileSync(out, html, 'utf8');
    console.log((once === html ? 'değişmedi: ' : 'yazıldı: ') + page.slug + '.html');
  }
  if (check) {
    if (bayat) process.exit(1);
    console.log('Güncel');
  }
}

if (require.main === module) main();

module.exports = { SAYFALAR, parse, render };
