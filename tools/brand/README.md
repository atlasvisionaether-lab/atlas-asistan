# Marka varlıkları — Atlas Asistan logosu (2026-10-26)

İşaret: gök küresi (yıldız haritası: meridyen + ekvator) + takımyıldızı "A" (tepede 4 kollu yıldız)
+ "A"nın yatay çizgisi olan eğik yapay zekâ yörüngesi (arka yarısı A'nın arkasından, ön yarısı önünden).
Renk: altın (#fde68a → #fbbf24 → #f59e0b) ve cyan (#22d3ee / #67e8f9 / #a5f3fc); koyu zemin için.

| Dosya | Kullanım |
|---|---|
| `public/logo/atlas-mark.svg` | işaret (yıldız ışıldar, uydu nabız atar; reduced-motion'da durur) — menü, hero, yükleme ekranı; panelde `panel/assets/logo.svg` |
| `public/logo/atlas-logo.svg` | yatay logo: işaret + "Atlas Asistan" (Fraunces 600, **yollara çevrilmiş** — yazı tipi yüklenmeden de aynı) |
| `public/logo/atlas-favicon.svg` | sade favicon (soluk çizgiler yok, kalın) — `panel/assets/favicon.svg` |
| `public/icon.png` (512), `public/apple-touch-icon.png` (180), `public/favicon.ico` (16/32/48), `public/logo/atlas-og.png` (1200×630) | raster: sosyal paylaşım, Apple, eski tarayıcılar, JSON-LD logo |

Yeniden üretmek (betikler bu klasörde; yazı tipi indirmesi ayrı, güvenilmeyen dizine):

```bash
pip install --target /tmp/pylib fonttools
# Fraunces 600 (opsz 144), yalnız gerekli harfler:
curl -s -A "Mozilla/4.0" "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@144,600&text=AtlasAisn"   # içindeki url'yi indir → /tmp/font-dl/fraunces.ttf
python3 -I tools/brand/outline_text.py /tmp/pylib /tmp/font-dl/fraunces.ttf Atlas Asistan > /tmp/outlines.json
python3 -I tools/brand/build_logo.py /tmp/outlines.json public/logo
NODE_PATH=$(npm root -g) node tools/brand/render_raster.js public/logo /tmp/raster
python3 -I tools/brand/make_ico.py /tmp/raster/favicon.ico /tmp/raster/fav-16.png /tmp/raster/fav-32.png /tmp/raster/fav-48.png
```
Sonra raster dosyalarını `public/` ve `panel/` altına kopyala; SVG'leri `panel/assets/`'e.
