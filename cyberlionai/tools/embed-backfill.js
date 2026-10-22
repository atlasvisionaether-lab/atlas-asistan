'use strict';

/**
 * Bir kerelik: vektörsüz asistan mesajlarına vektör üretir.
 *
 * 2026-10-21'de Vercel ile Supabase'deki EMBED_SHARED_SECRET uyuşmadığı için
 * embed 401 döndü; o aralıkta hafızaya yazılan mesajlar vektörsüz kaldı
 * (memory.appendMessages vektör yoksa satırı yine yazar) ve anlamsal
 * aramada görünmüyor. Bu araç onları canlıdaki yoldan (api/_lib/embed.js:
 * DeepSeek çeviri + Edge Function gte-small) vektörleştirir.
 *
 *   node tools/embed-backfill.js            # kuru çalışma: yalnızca sayar
 *   node tools/embed-backfill.js --apply    # yazar
 *   node tools/embed-backfill.js --apply --max 200
 *
 * Ortam: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EMBED_SHARED_SECRET,
 * DEEPSEEK_API_KEY (--apply için zorunlu: çevirisiz vektör yazılmaz).
 *
 * Güvenceler
 *   - Yalnızca hafızası HÂLÂ açık (remember_me = true) kullanıcıların
 *     satırları işlenir; "unut beni" demiş birinin kalıntısına dokunulmaz.
 *   - Güncelleme `embedding=is.null` koşuluyla: bu arada canlı yoldan vektör
 *     yazılmış ya da satır silinmişse hiçbir şey değişmez (PATCH satır
 *     yaratamaz).
 *   - Mesaj metni zaten maskeli (ai-redact) saklanıyor; hiçbir metin
 *     loglanmaz, yalnızca sayılar.
 */

const path = require('node:path');
const API = path.join(__dirname, '..', 'api', '_lib');
const db = require(path.join(API, 'db.js'));
const embed = require(path.join(API, 'embed.js'));
const llm = require(path.join(API, 'llm.js'));

const BATCH = 16;
const args = process.argv.slice(2);
const APPLY = args.indexOf('--apply') !== -1;
const maxIdx = args.indexOf('--max');
const MAX = maxIdx !== -1 ? Math.max(1, parseInt(args[maxIdx + 1], 10) || 0) : Infinity;

async function rememberedUsers() {
  const rows = await db.request('cl_user_prefs?remember_me=eq.true&select=user_id');
  return new Set((rows || []).map(function (r) { return r.user_id; }));
}

async function pending(afterId) {
  return db.request('cl_assistant_messages?select=id,user_id,content&embedding=is.null'
    + '&id=gt.' + afterId + '&order=id.asc&limit=' + BATCH) || [];
}

async function main() {
  if (!db.isConfigured()) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY gerekli');
  if (!embed.isConfigured()) throw new Error('EMBED_SHARED_SECRET gerekli');
  /* Çevirisiz gte-small vektörü Türkçede işe yaramaz ve kalıcıdır (sonraki
     çalıştırmalar embedding=is.null olmayan satıra dokunmaz): anahtarsız
     yazılmaz. Kuru çalışma anahtarsız da sayar. */
  if (APPLY && !llm.config().deepseek) throw new Error('DEEPSEEK_API_KEY gerekli (çeviri olmadan vektör yazılmaz)');

  const remembered = await rememberedUsers();
  const say = { bulunan: 0, atlanan_hafiza_kapali: 0, yazilan: 0, degismeyen: 0, hata: 0 };
  let last = 0;

  while (say.bulunan < MAX) {
    const rows = await pending(last);
    if (!rows.length) break;
    last = rows[rows.length - 1].id;

    const hedef = rows.filter(function (r) { return remembered.has(r.user_id); })
      .slice(0, MAX - say.bulunan);
    say.atlanan_hafiza_kapali += rows.length - rows.filter(function (r) { return remembered.has(r.user_id); }).length;
    say.bulunan += hedef.length;
    if (!APPLY || !hedef.length) continue;

    let vectors;
    try {
      /* Çeviri düşerse parti atlanır (satır vektörsüz kalır, sonraki
         çalıştırmada yeniden denenir); çevirisiz kalıcı vektör yazılmaz. */
      vectors = await embed.embed(hedef.map(function (r) { return r.content; }), { requireTranslation: true });
    } catch (err) {
      say.hata += hedef.length;
      console.error('embed başarısız (' + String(err && err.message).slice(0, 40) + '), parti atlandı');
      continue;
    }
    for (let i = 0; i < hedef.length; i += 1) {
      try {
        const out = await db.request('cl_assistant_messages?id=eq.' + hedef[i].id + '&embedding=is.null', {
          method: 'PATCH',
          body: { embedding: embed.toPg(vectors[i]) },
          headers: { 'Prefer': 'return=representation' }
        });
        if (Array.isArray(out) && out.length) say.yazilan += 1; else say.degismeyen += 1;
      } catch (err) {
        say.hata += 1;
      }
    }
  }

  console.log((APPLY ? 'UYGULANDI' : 'KURU ÇALIŞMA (yazmak için --apply)') + ' ' + JSON.stringify(say));
  if (say.hata) process.exitCode = 1;
}

main().catch(function (err) {
  console.error('HATA', err && err.message);
  process.exit(1);
});
