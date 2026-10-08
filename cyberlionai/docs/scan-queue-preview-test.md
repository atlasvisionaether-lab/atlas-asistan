# `SCAN_QUEUE_ENABLED` — Preview sınama planı

Bayrak **önce Preview'da** açılır, Production'da değil. Gerekçe: bayrak
açıldığı an ana sayfadaki tarayıcı kuyruğa bağımlı hâle gelir. Lambda'nın
gerçekten iş bitirdiği görülmeden Production'a dokunulmaz.

Bu plan, bayrağı açmadan önce ve açtıktan sonra **tam olarak neye bakılacağını**
sırayla veriyor. Her adımın bir **geçme ölçütü** var; biri tutmazsa sonraki
adıma geçilmez ve bayrak kapatılır.

## 0. Önkoşullar

Bunlar olmadan bayrak açılmaz:

- [ ] `db/migrations/007_scan_jobs_progress.sql` uygulandı
- [ ] `db/2026-10-02-scan-queue.sql` uygulandı
- [ ] `db/2026-10-02-clscans-job-link.sql` uygulandı
- [ ] SQS kuyruğu + DLQ ayakta (`maxReceiveCount` 3)
- [ ] S3 kovası ayakta, herkese kapalı, AES256 zorunlu
- [ ] Lambda yayında, event source mapping **etkin**
- [ ] `enqueue-scan` ve `sign-report` dağıtıldı, gizli değişkenleri girildi
- [ ] Vercel Preview'da: `ENQUEUE_SHARED_SECRET`, `SIGN_SHARED_SECRET`

Adımlar ve komutlar: `docs/scan-queue.md`.

## 1. Bayrak KAPALIYKEN hiçbir şey değişmedi mi

Bayrak açılmadan önce ölçülüyor; sonra karşılaştırmak için.

| # | Ne yapılır | Geçme ölçütü |
|---|---|---|
| 1.1 | Ana sayfadan bir tarama | Sonuç tablosu eskisi gibi çiziliyor |
| 1.2 | `POST /api/enqueue-scan` | **404** `enqueue_unavailable` |
| 1.3 | 1.2'den sonra kota | **Değişmedi** — 404 hak harcamaz |
| 1.4 | `GET /api/scan-status?id=<uuid>` | **404** `not_found` (göç uygulandıysa) |
| 1.5 | Dünya haritası etkinlik katmanı | Tarama sonrası sayı **arttı** |

1.3 kritik: 404 kota ayırmadan önce veriliyor. Harcasaydı, geri düşen her
tarama iki hak yerdi.

1.4'te **503** görülürse göç eksik — devam etmeyin.

## 2. Bayrağı Preview'da aç

Vercel > cyberlionai > Settings > Environment Variables > **Preview**:
`SCAN_QUEUE_ENABLED=true`. Sonra Preview dağıtımını yeniden tetikleyin
(ortam değişkeni yalnızca yeni dağıtımda okunur).

## 3. Kuyruk yolu gerçekten çalışıyor mu

| # | Ne yapılır | Geçme ölçütü |
|---|---|---|
| 3.1 | `POST /api/enqueue-scan` `{"url":"example.com"}` | **200** ve `{ scanId: <uuid> }` |
| 3.2 | `scan_jobs` satırı | `status` `pending` → `queued` → `running` → `completed` |
| 3.3 | Yoklama sırasında `current_step` | `scanning_headers` → `generating_report` |
| 3.4 | İlerleme çubuğu | Sunucunun `progress` değerini izliyor, **zıplamıyor** |
| 3.5 | Sonuç | Tablo eşzamanlı yoldakiyle **aynı** çiziliyor |
| 3.6 | `scan_findings` | Bulgular yazılmış |
| 3.7 | S3 kovası | `reports/<yıl>/<ay>/<scanId>.pdf` var |
| 3.8 | `scan_jobs.report_url` ve `report_key` | Dolu |
| 3.9 | `cl_scans` | **Bir** yeni satır, `job_id` dolu |
| 3.10 | Dünya haritası | Sayı arttı |

3.4 için: sayaç duruyor ve çubuğu sunucu sürüyor. İki değer arasında ileri
geri zıplıyorsa `clearInterval(ticker)` çalışmamış.

## 4. İmzalı rapor indirme

| # | Ne yapılır | Geçme ölçütü |
|---|---|---|
| 4.1 | **Oturum kapalı** tarama yap, PDF düğmesi | **Görünüyor** |
| 4.2 | Düğmeye bas | PDF iniyor (302 → imzalı S3 adresi) |
| 4.3 | İnen adresi kopyala, **3 dk sonra** aç | **Reddediliyor** (süre doldu) |
| 4.4 | Başka bir tarayıcı oturumunda aynı `?id=` | **404** `not_found` |
| 4.5 | `report_url` değerini doğrudan aç | **Reddediliyor** (kova özel) |
| 4.6 | Oturum **açık** tarama, PDF düğmesi | `/api/report?jobId=` — seçilen dilde |
| 4.7 | `GET /api/report-download?id=` 11 kez | 11.'de **429** |

4.4 en önemlisi: sahiplik süzgeci sorgunun içinde, iş kimliğini bilmek
başkasının raporunu açmaya yetmiyor.

4.3 ve 4.5 birlikte: kalıcı, paylaşılabilir bir bağlantı yok.

## 5. Hata yolları

| # | Ne yapılır | Geçme ölçütü |
|---|---|---|
| 5.1 | Ulaşılamayan hedef tarat (`http://192.0.2.1`) | İş `queued` kalıyor, **`failed` DEĞİL** |
| 5.2 | 5.1'i izle | 3 teslimden sonra `failed`, mesaj DLQ'da |
| 5.3 | 5.1 sırasında arayüz | Tarama **sürüyor** görünüyor, hata vermiyor |
| 5.4 | Engelli hedef (`localhost`) | Anında **403**, kuyruğa iş bırakılmıyor, kota iade |
| 5.5 | Lambda'yı geçici durdur, tarama yap | İş `queued` kalıyor, istemci 2 dk sonra vazgeçiyor; Lambda açılınca iş **bitiyor** |
| 5.6 | Aynı mesajı elle iki kez kuyruğa bırak | `cl_scans`'te **tek** satır |

5.1–5.3 bildirilmiş hatanın sınaması: yeniden denenen tarama terminal
`failed` yazmamalı, yoksa kullanıcı çalışan bir taramayı başarısız görür.

## 6. Geri alma

Bayrağı silmek yeter: `SCAN_QUEUE_ENABLED`'ı kaldır ve yeniden dağıt. Kod
eşzamanlı yola döner. Kuyrukta kalan işleri Lambda yine bitirir; kullanıcı
onları panelde görür.

Geri almayı gerektiren durumlar: 3.2'de iş `queued`'da takılı kalıyor, 3.5'te
sonuç eşzamanlı yoldan farklı, 4.4 başkasının raporunu açıyor (bu bir
**güvenlik** durumu, hemen geri al).

## 7. Production'a geçiş

5'teki tüm ölçütler tuttuktan **ve** Preview'da en az bir gün gerçek tarama
yapıldıktan sonra Production'da `SCAN_QUEUE_ENABLED=true`. Aynı 3 ve 4
adımları Production'da bir kez daha koşulur.

## Bilinen sınırlar (bayrak açılmasını engellemez)

- **S3'teki PDF yalnızca Türkçe.** Lambda raporu `tr` ile üretiyor. Oturum
  açık kullanıcılar seçilen dilde raporu `/api/report?jobId=` üzerinden
  alıyor; anonim kullanıcı Türkçe kopyayı iniyor.
- **Pro 50 tarama kotası** hâlâ uygulanmıyor (Faz 6, bilinçli).
- `enqueue-scan` ve `sign-report` imzaları bu depoda **yapısal** olarak
  sınanıyor; Deno çalıştırılamadığı için canlı imza ilk gerçek çağrıda
  doğrulanıyor (3.1 ve 4.2 bunu kapsıyor).
