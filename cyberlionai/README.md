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
├── gizlilik-politikasi.html
├── kullanim-sartlari.html
├── cerez-politikasi.html
├── 404.html
├── vercel.json      Güvenlik başlıkları, temiz URL'ler, yönlendirmeler
├── _headers         Aynı başlıkların Cloudflare Pages / Netlify karşılığı
├── tools/
│   └── csp-hashes.py   CSP script hash'lerini üretir
├── db/migrations/   Veritabanı şeması (üç modlu düzeltme)
├── docs/api.md      API sözleşmesi
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


## Üç modlu düzeltme (remediation)

Ana sayfadaki **Düzeltme** bölümü müşteriye üç yöntem sunar:

| Mod | Anahtar | Davranış |
|---|---|---|
| Tam Otomatik | `autonomous` | Düzeltmeyi onay beklemeden uygular, hata hâlinde geri alır |
| Yarı Otomatik | `semi_autonomous` | Düzeltmeyi önerir, müşteri onayından sonra uygular |
| Yönetilen Hizmet | `managed` | AI + uzman ekip birlikte çalışır, ticket açılır |

Seçim `localStorage.preferredRemediationMode` içine yazılır ve
`POST /api/user/preferences` ile sunucuya gönderilir. Sonraki
`POST /api/scan` istekleri seçilen modu `mode` alanında taşır.

### ⚠️ Bu bölümün hangi kısmı canlı?

**Hazır ve çalışıyor:** seçim arayüzü, karşılaştırma tablosu, onay modalı,
tercih kaydı, TR/EN çeviriler, API istemci katmanı (`API.remediate`,
`API.getApprovals`, `API.respondApproval`, `API.getRemediationStatus`,
`API.getManagedTicket`), veritabanı şeması ve API sözleşmesi.

**Henüz yok:** düzeltmeleri gerçekten uygulayan motor. Bu, müşterinin
altyapısında değişiklik yapan (GitHub PR açan, Cloudflare kuralı yazan, AWS
güvenlik grubu güncelleyen) bir sunucu bileşenidir ve statik bir sayfada
çalışamaz. `CONFIG.useMockApi = true` olduğu sürece bu uçlar demo yanıt
döndürür.

**Yayına almadan önce:** motor bağlanana kadar bu bölümdeki fiyatlarla satış
yapmayın veya bölümü gizleyin. Ücretli bir "otomatik düzeltme" vaadi, arkasında
çalışan bir motor olmadan yanıltıcı olur.

### Fiyat notu

Bölümdeki fiyatlar (₺299 / ₺199 / ₺2.499) düzeltme yöntemi başınadır ve
`Fiyatlandırma` bölümündeki plan fiyatlarından (Free / Pro ₺299/ay /
Enterprise) ayrıdır. İki liste birbiriyle çelişirse tek bir yapıya
indirilmesi gerekir.

## Güvenlik başlıkları ve CSP

`vercel.json` her yanıta CSP, HSTS (preload), `X-Frame-Options: DENY`,
`nosniff`, `Referrer-Policy`, `Permissions-Policy` ve COOP ekler.

CSP, satır içi script'ler için `'unsafe-inline'` yerine **sha256 hash**
kullanır. Bu yüzden:

> **Bir `<script>` bloğunu her düzenlediğinizde `python3 tools/csp-hashes.py`
> çalıştırın.** Aksi hâlde tarayıcı script'i engeller ve sayfa çalışmaz.
> `python3 tools/csp-hashes.py --check` yalnızca kontrol eder (CI için uygundur).

## Yasal metinler hakkında

`gizlilik-politikasi.html`, `kullanim-sartlari.html` ve `cerez-politikasi.html`
sektör standardı şablonlardan üretilmiştir ve sitenin gerçek davranışına göre
yazılmıştır (örneğin çerez politikası, yalnızca localStorage kullanıldığını
doğru biçimde anlatır).

**Yine de yayına almadan önce bir hukuk danışmanına inceletin.** Özellikle
KVKK aydınlatma yükümlülüğü, saklama süreleri ve yurt dışına aktarım maddeleri
şirketinizin gerçek işleyişine göre uyarlanmalıdır.

## Dağıtım (Vercel)

Proje `atlasvisionaether-lab/atlas-asistan` deposuna bağlıdır; `main` dalına
her push otomatik olarak production'a çıkar. Root dizin: `cyberlionai`.

- Proje: `cyberlionai` (takım: Atlas' projects)
- Üretim URL'si: `cyberlionai.vercel.app`
- Alan adı: `cyberlionai.com` — Vercel panelinden projeye eklenmesi ve
  DNS kayıtlarının Vercel'e yönlendirilmesi gerekir.

## Canlı destek asistanı

Sağ altta yüzen **Canlı Asistan** düğmesi bir sohbet paneli açar. Üç kademeli
çalışır:

| Kademe | Nerede çalışır | Bugün |
|---|---|---|
| 1. Anlık yanıt | Tarayıcıda, gömülü bilgi tabanından | ✅ Çalışıyor |
| 2. Derin analiz | `POST /api/support` (sunucu) | ⏳ Backend bekliyor |
| 3. Uzman yönlendirmesi | Aciliyet puanı ≥ 6 veya eşleşme yok | ✅ Çalışıyor |

**1. kademe** 14 konuluk bir bilgi tabanından yanıt verir: tarama başlatma,
ücretsiz plan, fiyatlandırma, düzeltme yöntemleri, CSP, HSTS, X-Frame-Options,
TLS sürümleri, çerez bayrakları, yetkilendirme şartı, rapor biçimi, veri
saklama, doğruluk ve iletişim. Güvenlik başlığı sorularında kopyalanabilir
yapılandırma örneği verir. Ağ isteği yapmaz, çevrimdışı da çalışır.

**3. kademe** aciliyet puanı hesaplar (kritik kelime +4, yüksek kelime +2,
üst sınır 10). Eşiği aşan veya bilgi tabanında karşılığı olmayan sorularda,
soruyu taşıyan bir `mailto:destek@cyberlionai.com` bağlantısı sunar.

Yeni konu eklemek için `translations.tr.kb` ve `translations.en.kb` içine
kaydı, `assistant` içindeki `TOPICS` haritasına anahtar kelimeleri ekleyin.
Ardından **`python3 tools/csp-hashes.py` çalıştırmayı unutmayın.**

### ⚠️ Dürüstlük notu

Asistan sitenizi taramaz, hesabınıza erişmez ve arka planda birden fazla dil
modeli çalıştırmaz. Panelde bu, kullanıcıya açıkça yazılıdır. Pazarlama
metninde bunun ötesinde bir iddiada bulunmadan önce 2. kademenin gerçekten
devreye alınması gerekir.
