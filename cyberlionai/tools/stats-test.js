'use strict';
/**
 * Ana sayfa sayacının NEYİ saydığını sınar. Ağdan bağımsız.
 *
 *   node tools/stats-test.js
 *
 * NEDEN
 *
 * Sayaç `scan_jobs` tablosunu sayıyor, ama o tablo yalnızca tarama tutmuyor:
 * Cloudflare 1-Tık Düzeltme'nin denetim izi de aynı tabloya yazılıyor
 * (`saveAutofixJob`, url'si `cloudflare-transform://`). Ayıklama olmadan
 * "taranan site" sayısı her düzeltmede bir artardı — yani ziyaretçiye
 * gösterilen sayı yanlış olurdu. Bu sınama tam olarak o ayrımı yakalıyor:
 * fikstürde 1 düzeltme satırı ve 1 başarısız tarama var, ayıklanmazsa
 * toplam 3 yerine 5 çıkar.
 *
 * Ayrıca sınanan:
 *   - ortalama skor YALNIZCA skoru olan taramalardan (başarısız tarama
 *     skoru null bırakır; sıfır sayılması ortalamayı yanlış aşağı çeker),
 *   - benzersiz alan adı sayımı büyük/küçük harf duyarsız,
 *   - son yedi günün iskeleti tarama olmayan günleri 0 ile TAŞIYOR (düşerse
 *     grafik günleri kaydırır),
 *   - üst sınıra dayanılması saklanmıyor (`truncated`).
 */

process.env.SUPABASE_URL = 'https://ornek.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sahte-servis-rolu-anahtari';

const db = require('../api/_lib/db.js');

let sorgu = null;

/* Yanıt gövdesi fetch'in yerine konuyor: modül fetch'i global'den alıyor. */
function sahteFetch(rows) {
  global.fetch = function (url) {
    sorgu = String(url);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: function () { return Promise.resolve(rows); },
      text: function () { return Promise.resolve(''); }
    });
  };
}

function gunOnce(n) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

let hata = 0;
function esit(ad, bulunan, beklenen) {
  const ok = JSON.stringify(bulunan) === JSON.stringify(beklenen);
  if (!ok) hata++;
  console.log((ok ? '  ok  ' : '  HATA') + '  ' + ad
    + (ok ? '' : '\n        beklenen: ' + JSON.stringify(beklenen)
              + '\n        bulunan : ' + JSON.stringify(bulunan)));
}

(async function () {
  console.log('Sayaç sınaması (scan_jobs -> /api/stats)');

  /* ---- 1. Ayıklama ve ortalama ---- */
  sahteFetch([
    { domain: 'bir.com',  score: 80, status: 'completed', url: 'https://bir.com',  created_at: gunOnce(0) },
    { domain: 'BIR.com',  score: 90, status: 'completed', url: 'https://bir.com',  created_at: gunOnce(1) },
    { domain: 'iki.com',  score: 70, status: 'completed', url: 'https://iki.com',  created_at: gunOnce(3) },
    /* Skoru olmayan tamamlanmış tarama: sayıya girer, ortalamaya girmez. */
    { domain: 'uc.com',   score: null, status: 'completed', url: 'https://uc.com', created_at: gunOnce(2) },
    /* Tarama DEĞİL: Cloudflare düzeltme denetim satırı. */
    { domain: 'bir.com',  score: null, status: 'completed', url: 'cloudflare-transform://bir.com/hsts', created_at: gunOnce(0) },
    /* Tamamlanmamış tarama: sayıya girmez. */
    { domain: 'dort.com', score: null, status: 'failed', url: 'https://dort.com',  created_at: gunOnce(0) }
  ]);

  const s = await db.scanStats();

  esit('tamamlanmış tarama sayısı (düzeltme + başarısız ayıklandı)', s.totalScans, 4);
  esit('benzersiz alan adı (BIR.com ile bir.com aynı)', s.uniqueDomains, 3);
  esit('ortalama skor yalnızca skoru olanlardan', s.averageScore, 80);
  esit('ortalamanın dayandığı tarama adedi', s.scoredScans, 3);
  esit('yedi günlük iskelet tam', s.last7Days.length, 7);
  esit('tarama olmayan gün 0 ile duruyor', s.last7Days[0].count, 0);
  esit('bugünün sayısı', s.last7Days[6].count, 1);
  esit('üst sınıra dayanılmadı', s.truncated, false);

  /* Alan adlarının KENDİSİ dışarı çıkmamalı: yanıtta yalnızca sayı var. */
  esit('yanıtta alan adı listesi yok', Object.keys(s).sort(), [
    'averageScore', 'last7Days', 'scoredScans', 'totalScans', 'truncated', 'uniqueDomains'
  ]);

  /* Sorgu sahiplik sütunu çekmiyor: sayaç kimliksiz. */
  esit('sorgu user_id/anonymous_session_id çekmiyor',
    /user_id|anonymous_session_id/.test(sorgu), false);

  /* ---- 2. Boş tablo ---- */
  sahteFetch([]);
  const bos = await db.scanStats();
  esit('boş tabloda toplam 0', bos.totalScans, 0);
  esit('boş tabloda ortalama null (0 değil)', bos.averageScore, null);
  esit('boş tabloda yine yedi gün', bos.last7Days.length, 7);

  /* ---- 3. Üst sınır ---- */
  const cok = [];
  for (let i = 0; i < 10001; i++) {
    cok.push({ domain: 'x' + i + '.com', score: 50, status: 'completed', url: 'https://x' + i + '.com', created_at: gunOnce(0) });
  }
  sahteFetch(cok);
  const sinir = await db.scanStats();
  esit('üst sınıra dayanıldığı saklanmıyor', sinir.truncated, true);
  esit('sınır üstü satır sayılmıyor', sinir.totalScans, 10000);

  console.log(hata === 0 ? '\nTümü geçti.' : '\n' + hata + ' sınama BAŞARISIZ.');
  process.exit(hata === 0 ? 0 : 1);
})();
