# Görev 7 — Klinik web sitesi üretimi (karar notları, 2026-10-26)

Durum (2026-10-26): **ilk sürüm yazıldı** — panel "Web Sitem" (`panel/scripts/site.js`), `/api/atlas-site`, `/api/atlas-site-render`, `api/_atlas/site/` (4 şablon, yapay zekâ metni, sağlık iddiası denetimi, onaylı yayın), 0022, Cloudflare Worker (`tools/cloudflare/`). VIP "10+ sayfa + blog" henüz yok (tek sayfa site).
Önceki durum: henüz kod yoktu. Web sitesi paketlerindeki (Dijital Başlangıç, VIP) siteler bugün elle yapılıyor.
Sitedeki vaat 2026-10-26'da tekleştirildi: **"bilgileriniz tamamlandıktan sonra 24 saat içinde yayında"**
(ana sayfa, /checkout, şehir sayfaları, blog, Ön Bilgilendirme Formu). Görev 7 bu vaadi otomatik karşılamalı.

## Yaklaşım (onaylandı): şablon + yapılandırılmış veri + yapay zekâ metni

1. Panelde **Site Bilgileri** formu: adres, telefon, harita, hakkımızda notları, fotoğraf, logo/renk, alan adı.
   Hizmet/fiyat ve çalışma saatleri mevcut tablolardan.
2. 3–4 **elle tasarlanmış premium şablon** (uzay/cam dili). Yapay zekâ tasarım yapmaz, boşluk doldurur.
3. Yapay zekâ (DeepSeek, `cyberlionai/api/_lib/llm.js`) **yalnız metin** yazar, katı JSON şemasıyla.
   **Fiyat, adres, telefon her zaman veritabanından — asla modelden.**
4. Statik HTML → `klinik.atlasasistan.com` (wildcard) ya da kliniğin alan adı (Vercel Domains API).
5. **Önizle → onayla → yayınla**; hizmet/fiyat değişince yeniden üret.

VIP "10+ sayfa + blog": hizmet başına sayfa + bölge (şehir/ilçe) sayfaları + schema.org/sitemap otomatik;
blog yazıları yapay zekâ taslağı. Google Business profili yarı-manuel (Google doğrulaması).

## ZORUNLU: sağlık hukuku — onay adımı

- **Öncesi/sonrası görseller:** sağlık hizmetlerinde tanıtım mevzuatıyla sınırlı. Galeri sayfası ve
  satış asistanındaki "Galeri (öncesi/sonrası)" ifadesi **bir hukukçuya teyit ettirilmeden yayınlanmaz**.
  Yapay zekâyla öncesi/sonrası görsel **asla üretilmez** (yanıltıcı).
- **Tıbbi içerik:** tedavi vaadi / sonuç garantisi / teşhis içeren cümle yayınlanmaz. Yapay zekâ metni
  filtreden geçer ve **klinik sahibi her sayfayı ve her blog yazısını onaylamadan yayın yok**
  (onay kaydı: kim, ne zaman, hangi sürüm).
- Rehberdeki kural aynen: model yalnız verilen bilgiyi kullanır, uydurmaz.

## VIP çok sayfalı site (0023)

- **Erişim:** `organizations.plan = 'vip'` ya da ödenmiş VIP siparişi (`atlas_orders.plan='vip', status='paid'`). Paket düşerse ek sayfalar sunulmaz (ana sayfa açık kalır).
- **Hizmet sayfaları:** her aktif hizmete bir sayfa (`/<hizmet-slug>`); fiyat/süre veritabanından. Pasifleşen hizmetin sayfası bir sonraki yayında iner.
- **Bölge sayfaları:** en çok 6; her biri bölge + hizmet + **kliniğin bölgeye özgü notu (≥40 karakter)**. Model semt bilgisini yalnız bu nottan alır. Amaç: aynı metni bölge adıyla çoğaltan "kapı sayfası" (doorway) cezasından kaçınmak.
- **Onay:** hizmet + bölge sayfaları ana sayfayla AYNI onayla yayınlanır; birinde bile riskli ifade varsa hiçbiri yayınlanmaz. **Blog yazıları tek tek**, her biri ayrı onay kutusuyla; onaylayan ve zaman kaydedilir (`approved_by/approved_at`). Blogda yapay zekâ yanıt vermezse yedek "yazı" uydurulmaz.
- **Silme yok:** kaldırma = `archived` (servis rolüne DELETE yetkisi verilmez).
- **Sunum:** `<alt>.atlasasistan.com/<sayfa>` (Worker) ve `atlasasistan.com/s/<alt>/<sayfa>` (noindex). Bağlantılar göreli; sunarken `<base href>` eklenir. `sitemap.xml` ve `robots.txt` (Sitemap satırıyla) kendiliğinden.
- **Sınır:** VIP günde 60 yazdırma (ana metin dahil); her istek tek sayfa (Vercel 60 sn).
- **Testler:** `node tools/atlas-site-vip-test.js`, `bash tools/atlas-site-vip-sql-test.sh`.
