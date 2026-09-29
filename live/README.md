# live/ — Canlı Varyant Arşivi

Bu klasör, **atlasasistan.com** canlı ana sayfasının versiyon kontrolüne alınmış kopyasını içerir.

## Nedir?

- `index.html`: atlasasistan.com ana sayfasının 2026-09-29 tarihinde indirilmiş tam kopyası.
- Canlı sayfa "Kliniğiniz Neden Müşteri Kaybediyor?" hero başlığına sahip zengin varyanttır: 3 sıkıntı kartı, web sitesi paketleri (₺14.900 / ₺24.900), asistan paketleri (₺4.900 / ₺7.900), 3 müşteri referansı, 7 soruluk SSS, iletişim formu ve 7/24 sohbet widget'ı içerir.
- Bu varyant, reponun `main` dalındaki sade kök `index.html`'den farklı olarak Vercel'de ayrı yönetilmektedir (Talimat 7'de doğrulandı: içerik reponun hiçbir branch/tag/commit'inde yoktu).

## Teknik Özellikler

- **Tamamen self-contained:** 2 inline `<style>` bloğu (~17 KB) + 2 inline `<script>` bloğu (~11 KB). Harici CSS/JS dosyası, font CDN'i veya `<img>` yok. Favicon data-URI (inline SVG).
- **Doğrudan editlenmez.** Yeni çalışmalar (aşağıda) bu varyantın **kopyası** üzerinden yeni branch'lerde yürütülecektir.

## Taşınacak Çalışmalar

Aşağıdaki çalışmalar `feat/legal-pages` ve `feat/performance` branch'lerinde sade varyant üzerinde yapıldı ve canlı varyanta uyarlanarak taşınacaktır (Talimat 9 planı):

| Çalışma | Kaynak Branch | Hedef |
|---|---|---|
| Yasal sayfalar (hakkinda, gizlilik, kvkk, iade, iletisim) | `feat/legal-pages` (`558ba8e`) | Canlı varyant tasarımına uyarlanıp köke eklenecek |
| SEO temeli (robots.txt, sitemap.xml, meta/OG, JSON-LD) | `feat/legal-pages` (`07cdd12`) | Canlı varyanta uygulanacak |
| Performans (preconnect, defer, font-display) | `feat/performance` (`9c73587`) | Canlı varyatta karşılıkları zaten self-contained; gerekirse uygulanacak |
| Font yükleme + guard'lı analitik yer tutucuları + tıklama takibi + 14 gün deneme CTA | `feat/performance` (`ae7fc0a`) | Canlı varyanta uyarlanacak |

## Dokunulmaz Alanlar

`cyberlionai/`, `panel/`, `supabase/`, `zayif-hedef/` ve `cyberlionai/index.html`'deki sohbet widget'ı + `cyberlionai/api/support.js` akışı bu çalışmalardan etkilenmez.
