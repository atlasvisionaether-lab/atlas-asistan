'use strict';

/**
 * RIR delegasyon dosyalarından IP→ülke tablosu üretir.
 *
 *   node tools/build-geo-table.js <indirilen-dosyalar-dizini> <cikti.js>
 *
 * Neden bu kaynak: beş bölgesel kayıt kuruluşu (RIPE NCC, ARIN, APNIC, LACNIC,
 * AFRINIC) IP aralığı → ülke kodu eşlemesini kamuya açık yayınlıyor. Anahtar
 * gerekmiyor, kullanım serbest. Ölçümde 261.154 IPv4 aralığı ve 240 ülke çıktı.
 *
 * Neden gerekiyor: haritanın "3 ülke" göstermesinin sebebi az besleme değil,
 * beslemelerin ülke taşımamasıydı. urlhaus ~3900 kayıt, torexit 1336 IP —
 * ikisinde de ülke yok. Bu tabloyla ikisi de haritaya girebiliyor.
 *
 * Çıktı biçimi: ikili, base64 ile bir JS modülüne gömülü.
 *   her aralık 9 bayt: 4 bayt baslangic (BE uint32), 4 bayt bitis, 1 bayt ulke
 * Aralıklar başlangıca göre sıralı; çözüm ikili arama ile O(log n).
 */

const fs = require('fs');
const path = require('path');

const ISO2 = /^[A-Z]{2}$/;

function ipToInt(s) {
  const p = String(s).split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const part of p) {
    const v = Number(part);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function main() {
  const dir = process.argv[2];
  const out = process.argv[3];
  if (!dir || !out) { console.error('kullanim: build-geo-table.js <dizin> <cikti.js>'); process.exit(2); }

  const rows = [];
  let atlanan = 0;

  for (const f of fs.readdirSync(dir)) {
    const metin = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const satir of metin.split('\n')) {
      if (!satir || satir[0] === '#') continue;
      const a = satir.split('|');
      // bicim: registry|cc|type|start|value|date|status[|opaque-id]
      if (a.length < 7 || a[2] !== 'ipv4') continue;
      // Ozet ve tahsis edilmemis kayitlar atlanir. Olcumde ozet satirlari
      // filtreye takilmisti ("afrinic|*|ipv4|*|5503|summary"); burada eleniyor.
      const cc = a[1];
      const durum = a[6];
      if (!ISO2.test(cc)) { atlanan++; continue; }
      if (durum !== 'allocated' && durum !== 'assigned') { atlanan++; continue; }
      const bas = ipToInt(a[3]);
      const adet = Number(a[4]);
      if (bas === null || !Number.isInteger(adet) || adet <= 0) { atlanan++; continue; }
      rows.push([bas, bas + adet - 1, cc]);
    }
  }

  if (!rows.length) { console.error('HATA: hic kayit okunamadi'); process.exit(1); }

  rows.sort(function (x, y) { return x[0] - y[0]; });

  /* Bitisik ve ayni ulkeye ait araliklari birlestir. Tablo boyutunu ciddi
     olcude dusuruyor ve cozum sonucunu hic degistirmiyor. */
  const merged = [];
  for (const r of rows) {
    const son = merged[merged.length - 1];
    if (son && son[2] === r[2] && r[0] <= son[1] + 1) {
      if (r[1] > son[1]) son[1] = r[1];
    } else {
      merged.push([r[0], r[1], r[2]]);
    }
  }

  const ulkeler = Array.from(new Set(merged.map(function (r) { return r[2]; }))).sort();
  if (ulkeler.length > 255) { console.error('HATA: 255 ulkeden fazla'); process.exit(1); }
  const idx = new Map(ulkeler.map(function (c, i) { return [c, i]; }));

  const buf = Buffer.alloc(merged.length * 9);
  let o = 0;
  for (const r of merged) {
    buf.writeUInt32BE(r[0], o); o += 4;
    buf.writeUInt32BE(r[1], o); o += 4;
    buf.writeUInt8(idx.get(r[2]), o); o += 1;
  }

  const b64 = buf.toString('base64');
  const uretim = new Date().toISOString().slice(0, 10);

  const modul = `'use strict';

/* ÜRETİLMİŞ DOSYA — elle düzenlemeyin.
 *
 * Kaynak: RIR delegasyon dosyaları (RIPE NCC, ARIN, APNIC, LACNIC, AFRINIC).
 * Kamu malı, anahtar gerektirmez. Yeniden üretmek için:
 *   .github/workflows/geo-table.yml iş akışını çalıştırın.
 *
 * Üretim tarihi : ${uretim}
 * Aralık sayısı : ${merged.length} (birleştirme öncesi ${rows.length})
 * Ülke sayısı   : ${ulkeler.length}
 * İkili boyut   : ${buf.length} bayt
 */

module.exports = {
  generatedAt: '${uretim}',
  ranges: ${merged.length},
  countries: ${JSON.stringify(ulkeler)},
  packed: '${b64}'
};
`;
  fs.writeFileSync(out, modul);

  process.stdout.write('okunan ham kayit : ' + rows.length + '\n');
  process.stdout.write('atlanan satir    : ' + atlanan + '\n');
  process.stdout.write('birlestirilmis   : ' + merged.length + '\n');
  process.stdout.write('ulke sayisi      : ' + ulkeler.length + '\n');
  process.stdout.write('ikili boyut      : ' + buf.length + ' bayt\n');
  process.stdout.write('modul boyutu     : ' + fs.statSync(out).size + ' bayt\n');
}

main();
