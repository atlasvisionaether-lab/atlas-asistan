# Panel Mimarisi (Prototip — DEMO)

Statik, sunucusuz, tek sayfa uygulama. Harici bağımlılık, CDN, ağ isteği veya kalıcı depolama yoktur.

## Yapı
- `index.html`: iskelet; üstte demo bandı, solda 13 ekran menüsü, sağda içerik alanı.
- `assets/logo.svg`: yerel SVG logo.
- `styles/app.css`: koyu tema, mobil uyumlu grid ve skip-link.
- `scripts/data/mock.js`: yalnızca sahte/demo veriler.
- `scripts/store.js`: bellek içi durum ve mock aksiyonlar.
- `scripts/ui.js`: güvenli DOM yardımcıları; metinler `textContent` ile eklenir.
- `scripts/app.js`: hash yönlendirmesi ve 13 ekran.

## Güvenlik ilkeleri
- Mock auth yoktur; gerçek oturum veya yetkilendirme iddiası taşımaz.
- Aksiyonlar yalnızca mock toast üretir; kalıcı veri ve ağ isteği yoktur.
- Sağlık/şikâyet içeriği insan devralma mock akışına yönlendirilir.
- `migrations/0001_panel_schema.sql` yalnızca taslaktır; ASLA ÇALIŞTIRILMAZ.

## Production notu
Gerçek sürümde auth, server tarafı authorization, tenant izolasyonu, KVKK süreçleri ve sağlayıcı entegrasyonları ayrı güvenlik incelemesiyle tasarlanmalıdır.
