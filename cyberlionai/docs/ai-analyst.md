# AI analist (NVIDIA Nemotron)

Tarama sonucunu müşteriye Türkçe anlatan katman. Ölçümü **yapmaz**, yapılmış
ölçümü anlatır.

## Neden motor puanı gösteriliyor, modelin puanı değil

Tarayıcı motorları (`api/_lib/engines/`) SSL, TLS sürümü, HSTS, CSP, çerez
bayrakları, SPF/DMARC/DKIM, DNSSEC ve karaliste kontrollerini **ölçüyor**.
Model bunları ölçmüyor, okuduğunu özetliyor. Bir dil modelinin ürettiği sayı
satılan ölçüm olamaz: müşteriye gösterilen puan daima `scanner_score`.
Modelin kendi puanı (`ai_score`) yalnızca sapmayı görmek için saklanıyor —
ikisi çok ayrışıyorsa istem ya da model yanlıştır.

## Taramanın gövdesi modele GİTMİYOR

`aianalyst.ozetle()` taramayı modele göndermeden önce indiriyor. Modele giden
tek şey:

- alan adı,
- motorun puanı ve özet sayıları (total/passed/failed/skipped),
- en çok 60 kontrol için **yalnızca** `id`, `severity`, `status`.

Gitmeyenler: ham başlık değerleri, `Set-Cookie` içerikleri, CSP'nin kendisi,
istemci IP'si, hesap e-postası, `detail` altındaki hiçbir alan. Bunu
`tools/aianalyst-test.js` kilitliyor; özetleyici kaldırılırsa sınama
"ham CSP değeri gitmiyor" / "IP gitmiyor" doğrulamalarıyla düşüyor.

## Anahtar

`NVIDIA_API_KEY` yalnızca `Authorization: Bearer <anahtar>` başlığında
kullanılıyor. Hiçbir loga, hiçbir yanıta, hiçbir veritabanı satırına
girmiyor; loglanan her dizge `gizle()` üzerinden geçiyor. 20 karakterden
kısa anahtar yapılandırma hatası sayılıp reddediliyor.

Anahtar yoksa katman **kapalı**: `/api/ai-report` 503 `ai_unconfigured`
döner, hiçbir ağ isteği yapılmaz, diğer uçlar etkilenmez.

### 403 Forbidden alıyorsanız

İki sebebi var ve ikisi de anahtar tarafında:

1. `Authorization` başlığı `Bearer ` öneki olmadan gönderilmiş. Kod öneki
   kendisi ekliyor, yani bu hata ancak anahtarın içine "Bearer" yazıldığında
   olur — `NVIDIA_API_KEY` **yalnızca** `nvapi-...` değerini taşımalı.
2. Anahtar süresi geçmiş. Yenisi:
   <https://build.nvidia.com/settings/api-keys>

Uç bu durumda 502 `ai_unauthorized` döner ve Telegram'a uyarı atar: sessiz
kalması, raporların neden boş geldiğini kimsenin fark etmemesi demek olurdu.

## Model yanıtı GÜVENİLMEZ veri

Model JSON döneceğine dair hiçbir garanti vermiyor. `jsonSok()` kod
çitlerini ayırıyor, çözemezse en dıştaki `{…}`'yi deniyor ve başarısızsa
`null` dönüyor — **tamir etmeye çalışmıyor**. `dogrula()` şemayı daraltıyor:
`risk_level` dört değerden biri olmak zorunda, `score` 0–100'e kırpılıyor,
metinler ve dizi uzunlukları sınırlı, kontrol karakterleri atılıyor. Şemaya
uymayan yanıt `ai_bad_output` koduyla reddediliyor, kaydedilmiyor.

Ham yanıt **veritabanında saklanmıyor**. Tek faydası ayıklama, bedeli
müşteri verisinin ikinci bir kopyası.

## Uç

```
POST /api/ai-report  { "jobId": "<uuid>" }   → üretir (gerekirse) ve kaydeder
GET  /api/ai-report?jobId=<uuid>             → yalnızca KAYITLI raporu döner
```

- Giriş zorunlu. Sahiplik `db.getJob(user.id, jobId)` ile, filtre sorgunun
  içinde: başka hesabın iş kimliğini bilmek 404 getirir.
- GET model çağırmaz. Pano GET ile yokluyor, "yok" alınca bir kez POST ediyor.
- Var olan rapor yeniden üretilmiyor: aynı taramaya iki kez ödeme yok.
- Hız sınırı IP başına saatte 10 üretim. Hesap başına değil: bir hesabın
  belirtecini ele geçiren birinin faturayı şişirmesi de sınırlanıyor.
- Tamamlanmamış tarama 409 `scan_not_ready`.

### Hata kodları

| Kod | Durum | Anlamı |
|---|---|---|
| `ai_unconfigured` | 503 | `NVIDIA_API_KEY` yok |
| `ai_unauthorized` | 502 | 401/403 — anahtar geçersiz veya süresi geçmiş (uyarı atar) |
| `ai_rate_limited` | 502 | NVIDIA 429 (uyarı atar) |
| `ai_timeout` | 502 | 20 sn içinde yanıt yok |
| `ai_unreachable` | 502 | ağ hatası |
| `ai_rejected` | 502 | yukarı akış başka bir hata döndü |
| `ai_bad_output` | 502 | yanıt şemaya uymadı |
| `scan_not_ready` | 409 | taramanın sonucu henüz yok |

## Göç

`db/2026-10-08-ai-reports.sql`. Yalnızca yeni tablo ekliyor; **mevcut
tabloların RLS'ine dokunmuyor**. `ai_reports` üzerinde RLS açık, sahiplik
`scan_jobs`'a join ile kuruluyor (tam olarak `scan_findings`'in yaptığı gibi),
anon politikası yok — tarayıcı veritabanına hiç bağlanmıyor.

## n8n

WORKFLOW 2 (AI Analyst) NVIDIA'yı doğrudan çağırmıyor; bizim ucumuzu
çağırıyor. Sebebi: n8n kullanıcının Windows makinesinde `localhost:5678`'de
çalışıyor ve üretimi karşılayamaz; ayrıca anahtarın iki yerde durması iki
sızıntı yüzeyi demek.

n8n'in bir kullanıcı oturumu yok, bu yüzden `/api/ai-report`'u değil
`/api/cron/ai-reports`'u çağırıyor:

```
GET /api/cron/ai-reports
Authorization: Bearer <CRON_SECRET>
```

**`/api/ai-report`'un makine yolu YOKTUR** ve olmamalı. Bir kimlik doğrulama
atlatma başlığı eklemek yerine deponun zaten kullandığı `_lib/cronauth.js`
kullanılıyor: fail-closed (iki yöntemden biri de yapılandırılmamışsa 503),
QStash imzası ya da `CRON_SECRET`, sır loglanmıyor.

Cron ucu sahiplik filtresi olmadan iş okuyor; bunun veri sızdırmamasının
sebebi yanıtının müşteri verisi TAŞIMAMASI: yalnızca `candidates`,
`generated` ve hata sayıları dönüyor. Üretilen rapor veritabanına yazılıyor,
oradan da yalnızca işin sahibi okuyabiliyor. `tools/ai-report-test.js` bu
ikisini de kilitliyor ("cron yanıtı alan adı taşımıyor", "yetkisizde iş
sorgulanmıyor").

Akışlar `cyberlionai/n8n/` altında.

## WORKFLOW 3 — raporun PDF'i ve Storage

```
POST /api/cron/ai-report-pdf?jobId=<uuid>
Authorization: Bearer <CRON_SECRET>
→ 200 { ok, via, bucket: "reports", key: "ai/<jobId>.pdf", bytes }
```

Uç `ai_reports` satırını okuyor, PDF'i üretiyor (`api/_lib/report-ai.js`) ve
gizli `reports` kovasına koyuyor (`api/_lib/storage.js`, `x-upsert` ile:
yeniden üretim kovada ikinci bir kopya biriktirmiyor).

**Neden ayrı bir uç:** WORKFLOW 3'ün eski hâli `/api/report`'u çağırıyordu ve
o uç **oturum** istediği için akış 401 ile düşüyordu. Doğru düzeltme
`/api/report`'a bir makine yolu açmak değildi — bir üstteki bölümde
`/api/ai-report` için yazılan gerekçenin aynısı geçerli. Onun yerine aynı
`_lib/cronauth.js` ile yetkilenen yeni bir uç eklendi.

**Yan fayda:** PDF'i uç ürettiği ve kendisi yüklediği için `n8n` artık
Supabase servis rolü anahtarını taşımıyor; anahtar yalnızca Vercel'de.

Bu uç da müşteri verisi döndürmüyor: gövdede alan adı, özet, bulgu ya da puan
yok. Kova yolu **istemciden alınmıyor**, `jobId`'den türetiliyor
(`aiReportStorageKey`); bir yol gezinmesi kovanın başka yerine yazabilirdi.
`storage.guvenliYol()` ayrıca `..`, baştaki `/`, çift `/` ve boşluklu yolu
reddediyor. `tools/aireportpdf-test.js` bunların hepsini kilitliyor (109
doğrulama, 10 mutasyonun 10'u yakalandı).

### PDF'in içeriği

Risk bandı (`risk_level`, rengi `report-owasp.js`'in önem derecesi
renkleriyle aynı aileden), **motorun puanı** (`scanner_score`), Türkçe özet
(`summary_tr`) ve **en çok üç** öncelikli aksiyon — artı varsa en çok beş öne
çıkan bulgu. Modelin kendi puanı (`score`) kâğıda **girmiyor**: müşterinin
elindeki belgede iki farklı sayı olması, hangisinin ölçüm olduğunu
belirsizleştirirdi.

İkinci bir PDF kütüphanesi girmedi: `api/_lib/pdf.js` paylaşılıyor. Gömülü
TrueType yazı tipi (Identity-H) gerekiyor, çünkü temel 14 yazı tipinde
`ı İ ş ğ` yok ve sessizce boş kutuya düşerler.

Model metni kâğıda basılırken güvenilmez veri sayılıyor: kontrol karakterleri
atılıyor, uzunluk kırpılıyor, IP'ler maskeleniyor (`maskIps`).

`404 no_ai_report` bir hata değil, sıra meselesi: WORKFLOW 2 raporu henüz
üretmemiş. WORKFLOW 3 bu durumu "beklemede" diye bitiriyor, kırmızıya
dönmüyor.

**`reports` kovası GİZLİ kalmalı.** `storage.js`'de bilerek bir `publicUrl()`
yardımcısı yok: kovanın bir gün yanlışlıkla public yapılması hâlinde böyle
bir yardımcı sızıntıyı normalleştirirdi.

## Doğrulanmayanlar

`integrate.api.nvidia.com` bu oturumun ağ ilkesiyle **engelli**: canlı çağrı
yapılamadı ve model kimliği (`nvidia/nemotron-3.5-lightning-30b-a3b`)
NVIDIA'ya karşı doğrulanmadı. Bu yüzden model adı ve taban adres ortam
değişkeniyle değiştirilebilir (`NVIDIA_MODEL`, `NVIDIA_BASE_URL`): ad
değişirse kod değişmiyor.
