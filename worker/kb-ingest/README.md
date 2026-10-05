# kb-ingest — Atlas Asistan bilgi bankası dönüştürücüsü (MinerU)

Salonların panelden yüklediği PDF / Word belgelerini [MinerU](https://github.com/opendatalab/MinerU)
ile Markdown'a çevirir, parçalar ve `knowledge_base` tablosuna yazar. Belge panelde
**onaylanınca** otomatik cevap (`supabase/functions/atlas-auto-reply`) onu kullanır.

```
panel (Bilgi Bankası) ──yükle──► Storage kb-uploads/<org>/… + kb_documents (pending)
        ▲                                   │
        │ onayla / reddet (kb_set_status)   ▼
        └──────── review ◄── bu işçi: indir → MinerU → chunker → knowledge_base
                                          │
atlas-auto-reply ── kb_search (yalnızca approved, kb_enabled açıksa) ──┘
```

## Neden ayrı bir işçi

MinerU Python + yerleşim/OCR modelleri gerektirir (birkaç GB). Vercel ya da Supabase
Edge Functions'ta çalışamaz; herhangi bir Docker ortamında (küçük bir VM yeter; GPU
hızlandırır ama şart değil) sürekli çalışan bir süreç olarak koşar.

## Çalıştırma

```bash
docker build -t atlas-kb-ingest worker/kb-ingest
docker run -d --restart unless-stopped --name atlas-kb-ingest \
  -e SUPABASE_URL=https://lfltontezrfcmjntsgix.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=...  \
  atlas-kb-ingest
```

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `SUPABASE_URL` | — | zorunlu |
| `SUPABASE_SERVICE_ROLE_KEY` | — | zorunlu; yalnızca bu sunucuda, asla tarayıcıda |
| `POLL_SECONDS` | 15 | kuyruk yoklama aralığı |
| `MINERU_BACKEND` | `pipeline` | CPU için `pipeline`; GPU varsa MinerU README'deki VLM arka uçları |
| `MAX_PAGES` | 60 | uzun belge işçiyi kilitlemesin (`0` = sınırsız) |
| `MINERU_TIMEOUT` | 900 | saniye |

Yerel deneme (veritabanı yok): `docker run --rm -v $PWD:/d atlas-kb-ingest python worker.py --file /d/fiyat-listesi.pdf`

**İlk gerçek koşuda doğrulayın:** `mineru` komut satırı seçenekleri sürümle değişebiliyor.
`-p/-o/-b` kullanılıyor; sayfa sınırı için `-e` (son sayfa dizini). Sürümünüzde farklıysa
`worker.py → mineru_markdown()` tek yer.

## Sınamalar (ağ / MinerU gerekmez)

```bash
python3 worker/kb-ingest/test_chunker.py
python3 worker/kb-ingest/test_worker.py
```

## Lisans

MinerU'nun lisansını kullanmadan önce kontrol edin (geçmişte AGPL-3.0). Bu işçi MinerU'yu
**değiştirmeden, ayrı bir süreç olarak** çalıştırır; ürünün geri kalanı onu yalnızca
veritabanı üzerinden kullanır. Yine de ticari kullanım için hukuki görüş alın.

## Gizlilik

Belgeler salonun kendi işletme belgeleridir (fiyat, politika). Kovada özel tutulur,
yalnızca kurum üyeleri ve bu işçi okuyabilir. Müşteri kişisel verisi içeren belge
yüklenmemesi panelde söylenir; içerik onaylanmadan asistana girmez.
