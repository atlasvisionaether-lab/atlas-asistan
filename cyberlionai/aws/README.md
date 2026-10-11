# AWS tarafı

| Dizin | Ne |
|---|---|
| `lambda-scanner/` | SQS tüketicisi tarama işçisi (Node 20, bağımlılık yok) |
| `iam/` | En az yetkili IAM/kova politikaları |

Kurulum adımları, ortam değişkenleri ve açma sırası tek yerde:
[`../docs/scan-queue.md`](../docs/scan-queue.md).

## Paket üretme

```bash
cd lambda-scanner && ./build.sh      # scanner.zip
```

`build.sh`, tarama motorunu (`api/_lib/scanner.js` ve bağımlılıkları) ve PDF
üretecini `_lib/` altına **kopyalar**. Kaynak tek yerde durur; `_lib/`,
`_assets/` ve `scanner.zip` sürüm denetiminde yoktur. İki ayrı tarayıcı kopyası
olsaydı skorlar iki yerde ayrışır ve hangisinin doğru olduğu belirsizleşirdi.

## Gizli anahtarlar

Bu dizinde hiçbir anahtar yok ve olmayacak.

- **Lambda** AWS kimliğini ortam değişkeniyle almaz; görev rolünü kullanır.
- **Kuyruğa iş bırakan** anahtar yalnızca Supabase'in gizli değişkenlerinde
  durur ve tek izni `sqs:SendMessage`'dir (`iam/enqueue-user-policy.json`).
- İmzalayıcı (`lambda-scanner/lib/sigv4.js`) hiçbir şey loglamaz;
  `tools/sigv4-test.js` dosyada `console` çağrısı olmadığını sınar.
