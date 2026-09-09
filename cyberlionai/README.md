# Cyber Lion AI — Landing Page

Yapay zeka destekli web güvenlik tarama platformu için çok dilli (TR/EN) tanıtım sayfası.
Tamamen statik: **tek bir `index.html`** içinde HTML + CSS + JavaScript. Derleme adımı, paket
yöneticisi veya sunucu tarafı bağımlılığı yoktur.

## Dosya yapısı

```
cyberlionai/
├── index.html        Sayfanın tamamı (HTML + CSS + JS)
├── tr/index.html     /tr/ → index.html?lang=tr yönlendirmesi (hreflang için)
├── en/index.html     /en/ → index.html?lang=en yönlendirmesi (hreflang için)
├── robots.txt
├── sitemap.xml
├── og-image.png     Sosyal medya paylaşım görseli (1200×630)
├── screenshot.png
└── README.md
```

## Yayına alma

Statik dosyalardır; herhangi bir web sunucusuna kopyalamak yeterlidir
(Nginx, Apache, Netlify, Vercel, GitHub Pages, cPanel...).

```bash
# yerel önizleme
python3 -m http.server 8080
# http://localhost:8080/cyberlionai/
```

Alan adı bağlandığında yapılacaklar:

1. **HTTPS zorunlu tutun.** Nginx için: `return 301 https://$host$request_uri;`
   Apache için `.htaccess`:
   ```apache
   RewriteEngine On
   RewriteCond %{HTTPS} off
   RewriteRule ^(.*)$ https://%{HTTP_HOST}/$1 [R=301,L]
   ```
2. Bu dizinin **içeriğini** web köküne kopyalayın (`cyberlionai/` klasörünü değil), böylece
   `og-image.png`, `robots.txt` ve `sitemap.xml` `https://cyberlionai.com/og-image.png`
   gibi kök adreslerden servis edilir.
3. Alan adı **cyberlionai.com** alınmıştır ve `canonical`, `hreflang`, `og:url`,
   `sitemap.xml`, `robots.txt` içindeki adresler bu alan adına göre hazırdır — değişiklik
   gerekmez. Farklı bir alan adı kullanılacaksa bu beş yerdeki adresleri güncelleyin.
4. `info@cyberlionai.com` / `destek@cyberlionai.com` adresleri ve footer'daki sosyal medya
   bağlantıları (`href="#"`) ile yasal sayfa bağlantıları (Gizlilik / Kullanım Şartları /
   Çerez Politikası) yer tutucudur — gerçek değerlerle değiştirin.

## Dil mekanizması

Öncelik sırası:

1. `?lang=tr` / `?lang=en` adres parametresi
2. `localStorage.preferredLang` (kullanıcının önceki tercihi)
3. `/tr/` veya `/en/` klasör yolu
4. Tarayıcı dili (`navigator.language`)
5. **Geo-IP** (`ipapi.co`) — yalnızca 1–3 yoksa, sayfa yüklendikten sonra asenkron çalışır;
   ülke `TR` ise Türkçeye geçer. İstek 2 saniyede zaman aşımına uğrar ve başarısız olursa
   tarayıcı dili geçerli kalır (sayfa hiçbir durumda beklemez).

Sağ üstteki TR/EN düğmeleri anında geçiş yapar, tercihi `localStorage`'a yazar ve adres
çubuğundaki `?lang=` parametresini günceller (sayfa yeniden yüklenmez).

Tüm metinler `index.html` içindeki `translations` nesnesindedir. Yeni metin eklemek için:

```html
<p data-i18n="services.s5d">Türkçe metin</p>
```
```js
translations.tr.services.s5d = 'Türkçe metin';
translations.en.services.s5d = 'English text';
```

Desteklenen öznitelikler: `data-i18n` (metin), `data-i18n-placeholder`, `data-i18n-aria`.
Değerler **yalnızca `textContent`/`setAttribute`** ile yazılır; `innerHTML` kullanılmaz (XSS koruması).

## Backend entegrasyonu

Arayüz, API katmanı üzerinden çalışır. Backend hazır olduğunda `index.html` içindeki
`CONFIG` bloğunda iki satır değiştirmek yeterlidir:

```js
var CONFIG = {
  apiBaseUrl: 'https://api.cyberlionai.com',
  useMockApi: false,   // true iken demo veriler kullanılır
  ...
};
```

Beklenen uç noktalar:

| Metot | Yol | Gövde | Kullanan |
|-------|-----|-------|----------|
| POST | `/api/scan` | `{ url, type: "quick"\|"full" }` | Hero'daki tarama formu |
| GET | `/api/scan/{scanId}` | — | Tarama sonucu |
| POST | `/api/auth/register` | `{ email, password }` | Kayıt modalı |
| POST | `/api/auth/login` | `{ email, password }` | (hazır, henüz arayüzde yok) |

`/api/scan/{scanId}` yanıt biçimi:

```json
{ "status": "completed", "score": 62,
  "findings": [ { "index": 0, "severity": "high", "passed": false } ] }
```

`severity`: `critical` | `high` | `medium` | `low`. `index`, `translations[lang].scan.findings`
dizisindeki metnin sırasıdır; backend serbest metin döndürecekse `addFinding()` fonksiyonunu
metni doğrudan alacak şekilde güncelleyin.

İstekler `Content-Type: application/json` ile gider; `#csrfToken` alanı doluysa
`X-CSRF-Token`, `localStorage.authToken` varsa `Authorization: Bearer ...` başlığı eklenir.
Formdaki `csrf_token` gizli alanı sunucu tarafından doldurulmak üzere boş bırakılmıştır.

## Öne çıkan davranışlar

- **"Deneme Sürümü" düğmesi modal açmaz** — yalnızca bilgi mesajı (toast) gösterir ve
  kullanıcıyı hero'daki tarama alanına götürür.
- **"Premium'a Geç" düğmelerinin tamamı** kayıt modalını açar (ESC, dışına tıklama ve X ile
  kapanır; odak tuzağı vardır).
- **Canlı demo tarama:** hero'daki alana bir alan adı yazıldığında ilerleme çubuğu, adım
  adım durum ve önem derecesine göre etiketlenmiş örnek bulgular gösterilir. Girdi
  temizlenir (`https://`, `www.`, yol atılır) ve alan adı biçimi doğrulanır.
- **Çerez bildirimi** (KVKK/GDPR) ilk ziyarette çıkar, cevap `localStorage`'a yazılır.
- **Tema düğmesi** karanlık/aydınlık geçişi yapar; tercih saklanır.

## Parçacık sistemi (performans)

`emberCanvas` üzerinde saf Canvas 2D ile çalışır:

- Renk başına bir kez "sprite" üretilir, her karede `drawImage` ile çizilir — parçacık başına
  gradyan hesaplanmadığı için 200+ parçacıkta 60 FPS korunur.
- Parçacık sayısı ekran genişliğine göre 80 / 150 / 220 olarak seçilir; kare süresi
  sürekli ölçülür, cihaz zorlanırsa sayı otomatik düşürülür.
- Sekme arka plana alındığında veya hero ekrandan çıktığında döngü durur.
- `prefers-reduced-motion: reduce` tercihinde animasyon çalışmaz, tek kare çizilir.
- `devicePixelRatio` en fazla 2 ile sınırlanır.

## Tarayıcı desteği

Chrome 90+, Firefox 88+, Safari 14+, Edge 90+.

## Notlar

- Google Fonts (Orbitron, Space Grotesk) ve Font Awesome 6.5.1 CDN üzerinden yüklenir;
  yayına alırken bu iki kaynağın erişilebilir olduğundan emin olun. Tamamen bağımsız bir
  kurulum istenirse dosyaları indirip yerel yola çevirin.
- `screenshot.png` alınırken Google Fonts erişilebiliyordu ancak cdnjs (Font Awesome)
  kurum politikasıyla engelliydi; bu yüzden görüntüde yazı tipleri doğru, ikonlar eksiktir.
  Canlı sitede ikonlar da yüklenir.
- `og-image.png` yalnızca metin ve SVG logodan oluşur, Font Awesome'a bağımlı değildir.
