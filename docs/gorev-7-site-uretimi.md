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
