---
name: profesyonel-web-sitesi
description: Landing page, web sitesi, hero bölümü veya pazarlama sayfası tasarlarken jenerik "AI slop" görünümünü engeller. Marka kimliği (renk + font çifti), 8px boşluk sistemi ve mikro-detayları koda başlamadan ÖNCE karara bağlatır, sonunda kanıt ister. Şu durumlarda kullan: "web sitesi yap", "landing page kur", "site tasarla", "hero bölümü", "açılış sayfası", "sayfayı güzelleştir", "tasarımı iyileştir", "bu site AI yapımı gibi duruyor".
---

# Profesyonel web sitesi (AI slop karşıtı)

Model değişmiyor — önden verilen kararlar değişiyor. Düz "bir web sitesi yap"
denince model en sık görülen şablona düşer. Bu skill o şablonu üç kararla kırar:
**marka kimliği → hiyerarşi → mikro-detay**.

## Yasak liste (AI slop belirtileri)

Aşağıdakilerin hiçbiri çıktıda olmayacak:

- **Mor→mavi linear-gradient arka plan** — en klişe imza.
- **Emoji ikon** (🚀 ✨ 💡) — yerine tek bir gerçek SVG ikon seti.
- Anlamsız glassmorphism / blur kart yığını.
- "Hero başlık + alt başlık + iki buton" şablonunun birebir kopyası.
- Stok görsel hissi veren illüstrasyon / 3D render.
- Her bölümde aynı boşluk, aynı boyutta kart — yani hiyerarşisizlik.
- `Lorem ipsum` veya uydurulmuş istatistik.

## 1. Önce marka kimliğini sabitle

Tek satır kod yazmadan şunları seç ve kullanıcıya söyle:

- **Renk:** konuya özel 1 ana + 1 nötr + 1 vurgu. Mor-mavi kombinasyonundan kaçın.
- **Font:** 1 başlık fontu + 1 gövde fontu (biri karakterli serif/display, biri
  okunaklı sans).
- **Boşluk:** 8px tabanlı ölçek — 8 / 16 / 24 / 32 / 48 / 64 / 96. Keyfi px yok.

Konu belirsizse renk ve font önerini gerekçesiyle sun, onay bekleme — ama ne
seçtiğini açıkça yaz.

## 2. Tipografi ve layout

- Başlıklarda gerçek hiyerarşi: `h1` belirgin büyük, `h2`/`h3` kademeli küçülsün.
- Bölümler arası boşluk yukarıdaki sabit ölçekten gelsin.
- Grid'i kırık simetriyle kur — her şey ortalanmış ve eşit genişlikte olmasın.

## 3. İçerik kuralları

- Gerçek metin yaz. Uydurma rakam, uydurma müşteri yorumu, sahte logo yok.
- Başlıklar jenerik olmasın: "En İyi Çözüm" değil, markaya özel iddia.
- Her bölümün **tek** bir mesajı olsun; üç fikri aynı bloğa sıkıştırma.

## 4. Mikro-detaylar (profesyonellik burada belli olur)

- Buton ve kartlarda hover durumu tanımlı; statik bırakma.
- Gölge ve kenarlık marka renginden türetilsin, varsayılan gri kalmasın.
- İkonlar aynı stil ailesinden — hepsi outline ya da hepsi solid.

## 5. Teknik kurallar

- Mobil öncelikli; tüm kırılım noktalarında kontrol et.
- Kontrast WCAG AA seviyesinde.
- Gereksiz kütüphane ve animasyon ekleme; sayfa hızlı açılsın.

## Bitiş şartı (atlanmaz)

"Profesyonel oldu" demek yasak. Bitirmeden önce şunları tek tek göster:

1. Seçilen marka renkleri ve font çifti — nerede kullanıldığı.
2. 8px boşluk sisteminin uygulandığı yerler.
3. Yasak listesinden hiçbirinin sayfada olmadığı.
4. Sayfanın görsel hali — ekran görüntüsü alabiliyorsan al (`run` skill'i veya
   Playwright), alamıyorsan bunu açıkça söyle ve nedenini yaz.

Kanıt yoksa iş tamamlanmış sayılmaz.

---

Kaynak: "Profesyonel Web Sitesi · Skill Kiti v1" — @burhankocabiyik.
