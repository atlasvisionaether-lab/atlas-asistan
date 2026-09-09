'use strict';

/**
 * Küçük PDF yazıcı — bağımlılık yok.
 *
 * Neden elle yazıldı: Türkçe karakterler (ı, İ, ş, ğ) PDF'in yerleşik
 * base-14 fontlarının WinAnsi kodlamasında yoktur. Doğru görünmeleri için
 * gerçek bir TrueType font gömmek gerekir; bu da Identity-H kodlamalı bir
 * Type0/CIDFontType2 yapısı demektir. Hazır bir kütüphane eklemek yerine
 * yalnızca ihtiyacımız olan kadarı yazıldı, böylece proje bağımlılıksız kaldı.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

/* ------------------------------------------------------------------
   TrueType ayrıştırma: karakter → glif eşlemesi ve genişlikler
   ------------------------------------------------------------------ */

function readTables(buf) {
  const count = buf.readUInt16BE(4);
  const tables = {};
  for (let i = 0; i < count; i++) {
    const rec = 12 + 16 * i;
    tables[buf.toString('latin1', rec, rec + 4)] = {
      offset: buf.readUInt32BE(rec + 8),
      length: buf.readUInt32BE(rec + 12)
    };
  }
  return tables;
}

/** cmap format 4 (BMP) — ihtiyacımız olan tüm karakterler bu aralıkta. */
function parseCmap(buf, tables) {
  const cmap = tables['cmap'];
  if (!cmap) throw new Error('font_no_cmap');
  const base = cmap.offset;
  const n = buf.readUInt16BE(base + 2);

  let sub = null;
  for (let i = 0; i < n; i++) {
    const rec = base + 4 + 8 * i;
    const platform = buf.readUInt16BE(rec);
    const encoding = buf.readUInt16BE(rec + 2);
    const offset = buf.readUInt32BE(rec + 4);
    if ((platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0) sub = base + offset;
  }
  if (sub === null) throw new Error('font_no_unicode_cmap');
  if (buf.readUInt16BE(sub) !== 4) throw new Error('font_cmap_format_unsupported');

  const segCountX2 = buf.readUInt16BE(sub + 6);
  const segCount = segCountX2 / 2;
  const endBase = sub + 14;
  const startBase = endBase + segCountX2 + 2;
  const deltaBase = startBase + segCountX2;
  const rangeBase = deltaBase + segCountX2;

  const map = new Map();
  for (let i = 0; i < segCount; i++) {
    const end = buf.readUInt16BE(endBase + 2 * i);
    const start = buf.readUInt16BE(startBase + 2 * i);
    const delta = buf.readInt16BE(deltaBase + 2 * i);
    const rangeOffset = buf.readUInt16BE(rangeBase + 2 * i);
    if (start === 0xFFFF) continue;

    for (let code = start; code <= end && code !== 0x10000; code++) {
      let gid;
      if (rangeOffset === 0) {
        gid = (code + delta) & 0xFFFF;
      } else {
        const gi = rangeBase + 2 * i + rangeOffset + 2 * (code - start);
        if (gi + 2 > buf.length) continue;
        gid = buf.readUInt16BE(gi);
        if (gid) gid = (gid + delta) & 0xFFFF;
      }
      if (gid) map.set(code, gid);
    }
  }
  return map;
}

function parseWidths(buf, tables, numGlyphs) {
  const hhea = tables['hhea'], hmtx = tables['hmtx'];
  const numHMetrics = buf.readUInt16BE(hhea.offset + 34);
  const widths = new Array(numGlyphs).fill(0);
  let last = 0;
  for (let g = 0; g < numGlyphs; g++) {
    if (g < numHMetrics) {
      last = buf.readUInt16BE(hmtx.offset + 4 * g);
    }
    widths[g] = last;
  }
  return widths;
}

/** Font dosyasını bir kez okur; sonraki çağrılar önbellekten döner. */
const fontCache = new Map();

function loadFont(file) {
  if (fontCache.has(file)) return fontCache.get(file);

  const buf = fs.readFileSync(path.join(__dirname, '..', '_assets', file));
  const tables = readTables(buf);
  const head = tables['head'], maxp = tables['maxp'], hhea = tables['hhea'];

  const unitsPerEm = buf.readUInt16BE(head.offset + 18);
  const numGlyphs = buf.readUInt16BE(maxp.offset + 4);

  const font = {
    data: buf,
    unitsPerEm: unitsPerEm,
    numGlyphs: numGlyphs,
    cmap: parseCmap(buf, tables),
    widths: parseWidths(buf, tables, numGlyphs),
    bbox: [
      buf.readInt16BE(head.offset + 36), buf.readInt16BE(head.offset + 38),
      buf.readInt16BE(head.offset + 40), buf.readInt16BE(head.offset + 42)
    ].map(function (v) { return Math.round(v * 1000 / unitsPerEm); }),
    ascent: Math.round(buf.readInt16BE(hhea.offset + 4) * 1000 / unitsPerEm),
    descent: Math.round(buf.readInt16BE(hhea.offset + 6) * 1000 / unitsPerEm)
  };
  fontCache.set(file, font);
  return font;
}

/** Metni glif kimliklerine çevirir; fontta olmayan karakter '?' ile değiştirilir. */
function toGlyphs(font, text) {
  const out = [];
  const str = String(text == null ? '' : text);
  for (const ch of str) {
    const code = ch.codePointAt(0);
    out.push(font.cmap.get(code) || font.cmap.get(63) || 0);
  }
  return out;
}

function textWidth(font, text, size) {
  let total = 0;
  for (const gid of toGlyphs(font, text)) total += font.widths[gid] || 0;
  return total * size / font.unitsPerEm;
}

/* ------------------------------------------------------------------
   Belge
   ------------------------------------------------------------------ */

const A4 = { width: 595.28, height: 841.89 };

function pdfEscape(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

class PdfDoc {
  constructor() {
    this.pages = [];
    this.current = null;
    this.usedGlyphs = { regular: new Set(), bold: new Set() };
    this.fonts = { regular: loadFont('WorkSans-Regular.ttf'), bold: loadFont('WorkSans-Bold.ttf') };
    this.addPage();
  }

  addPage() {
    this.current = { ops: [] };
    this.pages.push(this.current);
    return this.current;
  }

  /** Renk: 0–1 aralığında [r,g,b] */
  rect(x, y, w, h, color) {
    this.current.ops.push(
      color[0].toFixed(3) + ' ' + color[1].toFixed(3) + ' ' + color[2].toFixed(3) + ' rg',
      x.toFixed(2) + ' ' + (A4.height - y - h).toFixed(2) + ' ' + w.toFixed(2) + ' ' + h.toFixed(2) + ' re f'
    );
  }

  line(x1, y1, x2, y2, color, width) {
    this.current.ops.push(
      color[0].toFixed(3) + ' ' + color[1].toFixed(3) + ' ' + color[2].toFixed(3) + ' RG',
      (width || 0.7).toFixed(2) + ' w',
      x1.toFixed(2) + ' ' + (A4.height - y1).toFixed(2) + ' m ' +
      x2.toFixed(2) + ' ' + (A4.height - y2).toFixed(2) + ' l S'
    );
  }

  /** y: üstten uzaklık (yazı temeli). */
  text(x, y, str, opts) {
    const o = opts || {};
    const weight = o.bold ? 'bold' : 'regular';
    const font = this.fonts[weight];
    const size = o.size || 10;
    const color = o.color || [0, 0, 0];

    const glyphs = toGlyphs(font, str);
    glyphs.forEach(this.usedGlyphs[weight].add, this.usedGlyphs[weight]);

    let hex = '';
    for (const g of glyphs) hex += g.toString(16).padStart(4, '0');

    this.current.ops.push(
      'BT',
      '/' + (o.bold ? 'FB' : 'FR') + ' ' + size + ' Tf',
      color[0].toFixed(3) + ' ' + color[1].toFixed(3) + ' ' + color[2].toFixed(3) + ' rg',
      '1 0 0 1 ' + x.toFixed(2) + ' ' + (A4.height - y).toFixed(2) + ' Tm',
      '<' + hex + '> Tj',
      'ET'
    );
  }

  widthOf(str, size, bold) {
    return textWidth(this.fonts[bold ? 'bold' : 'regular'], str, size);
  }

  /** Metni verilen genişliğe göre satırlara böler. */
  wrap(str, size, maxWidth, bold) {
    const words = String(str).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? line + ' ' + word : word;
      if (this.widthOf(candidate, size, bold) <= maxWidth) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = word;
        // Tek bir kelime sığmıyorsa karakter karakter kır
        while (this.widthOf(line, size, bold) > maxWidth && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && this.widthOf(line.slice(0, cut), size, bold) > maxWidth) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  /* ---- Çıktı ---- */

  build() {
    const objects = [];
    const push = function (body) { objects.push(body); return objects.length; };

    // 1: katalog, 2: sayfa ağacı (numaralar sabit tutulur)
    push(null); // 1 — katalog, sonra doldurulur
    push(null); // 2 — sayfa ağacı

    const fontRefs = {};
    for (const weight of ['regular', 'bold']) {
      const font = this.fonts[weight];
      const used = Array.from(this.usedGlyphs[weight]).sort(function (a, b) { return a - b; });

      const fileRef = push({
        dict: '<</Length %LEN%/Filter/FlateDecode/Length1 ' + font.data.length + '>>',
        stream: zlib.deflateSync(font.data)
      });

      const descRef = push({
        dict: '<</Type/FontDescriptor/FontName/WorkSans'
          + '/Flags 32/FontBBox[' + font.bbox.join(' ') + ']/ItalicAngle 0'
          + '/Ascent ' + font.ascent + '/Descent ' + font.descent
          + '/CapHeight ' + Math.round(font.ascent * 0.72) + '/StemV ' + (weight === 'bold' ? 140 : 80)
          + '/FontFile2 ' + fileRef + ' 0 R>>'
      });

      // Genişlikler yalnızca kullanılan glifler için yazılır.
      let w = '';
      for (const gid of used) {
        w += gid + '[' + Math.round((font.widths[gid] || 0) * 1000 / font.unitsPerEm) + ']';
      }

      const cidRef = push({
        dict: '<</Type/Font/Subtype/CIDFontType2/BaseFont/WorkSans'
          + '/CIDSystemInfo<</Registry(Adobe)/Ordering(Identity)/Supplement 0>>'
          + '/FontDescriptor ' + descRef + ' 0 R/DW 1000/W [' + w + ']/CIDToGIDMap/Identity>>'
      });

      // ToUnicode: metnin kopyalanabilir ve aranabilir olması için
      const reverse = new Map();
      for (const [code, gid] of font.cmap) if (!reverse.has(gid)) reverse.set(gid, code);
      let cmapEntries = '';
      let count = 0;
      for (const gid of used) {
        const code = reverse.get(gid);
        if (code === undefined) continue;
        cmapEntries += '<' + gid.toString(16).padStart(4, '0') + '> <'
          + code.toString(16).padStart(4, '0') + '>\n';
        count++;
      }
      const toUnicode = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n'
        + '/CMapName /WorkSans def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n'
        + count + ' beginbfchar\n' + cmapEntries + 'endbfchar\nendcmap\n'
        + 'CMapName currentdict /CMap defineresource pop\nend\nend';
      const toUniRef = push({
        dict: '<</Length %LEN%/Filter/FlateDecode>>',
        stream: zlib.deflateSync(Buffer.from(toUnicode, 'latin1'))
      });

      fontRefs[weight] = push({
        dict: '<</Type/Font/Subtype/Type0/BaseFont/WorkSans/Encoding/Identity-H'
          + '/DescendantFonts[' + cidRef + ' 0 R]/ToUnicode ' + toUniRef + ' 0 R>>'
      });
    }

    const pageRefs = [];
    for (const page of this.pages) {
      const content = zlib.deflateSync(Buffer.from(page.ops.join('\n'), 'latin1'));
      const contentRef = push({ dict: '<</Length %LEN%/Filter/FlateDecode>>', stream: content });
      pageRefs.push(push({
        dict: '<</Type/Page/Parent 2 0 R/MediaBox[0 0 ' + A4.width + ' ' + A4.height + ']'
          + '/Resources<</Font<</FR ' + fontRefs.regular + ' 0 R/FB ' + fontRefs.bold + ' 0 R>>>>'
          + '/Contents ' + contentRef + ' 0 R>>'
      }));
    }

    objects[0] = { dict: '<</Type/Catalog/Pages 2 0 R>>' };
    objects[1] = { dict: '<</Type/Pages/Kids[' + pageRefs.map(function (r) { return r + ' 0 R'; }).join(' ')
      + ']/Count ' + pageRefs.length + '>>' };

    // Serileştirme
    const chunks = [];
    let offset = 0;
    const write = function (buf) {
      const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'latin1');
      chunks.push(b); offset += b.length;
    };

    write('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n');
    const offsets = [0];
    objects.forEach(function (obj, index) {
      offsets[index + 1] = offset;
      const dict = obj.stream ? obj.dict.replace('%LEN%', String(obj.stream.length)) : obj.dict;
      write((index + 1) + ' 0 obj\n' + dict + '\n');
      if (obj.stream) { write('stream\n'); write(obj.stream); write('\nendstream\n'); }
      write('endobj\n');
    });

    const xref = offset;
    let table = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
    for (let i = 1; i <= objects.length; i++) {
      table += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    write(table);
    write('trailer\n<</Size ' + (objects.length + 1) + '/Root 1 0 R>>\nstartxref\n' + xref + '\n%%EOF\n');

    return Buffer.concat(chunks);
  }
}

module.exports = { PdfDoc, A4, pdfEscape };
