# Atlas Asistan Panel Prototipi (DEMO)

Türkiye’deki güzellik, lazer/estetik merkezleri ve seçili klinikler için randevu, müşteri iletişimi, kampanya ve operasyon yönetimi panelinin statik prototipi.

## Uyarı
Bu bir prototiptir. Gerçek müşteri verisi, canlı entegrasyon, mesaj gönderimi ve oturum yönetimi yoktur. Tüm metrikler DEMO/ÖRNEK veridir.

## Yerel test
```powershell
python -m http.server 8080 --directory panel
```
Tarayıcı: `http://localhost:8080`

## Kapsam
13 ekran: Genel Bakış, Gelen Kutusu, Randevular, Müşteriler/Leadler, Kampanyalar, Otomasyonlar, Hizmetler/Fiyatlar, AI Asistan Ayarları, Tasarım/Widget, Eklentiler, Analitik, Ekip/Yetkiler, Ayarlar.

## Sınırlamalar
- Gerçek auth, veritabanı, API veya connector yoktur.
- Aksiyonlar yalnızca mock toast üretir.
- Kampanyalar gönderilmez.
- Widget canlı değildir.
- Migration dosyası yalnızca taslaktır.

## Vercel Preview

Bu demo panel, ayrı atlas-asistan-panel-preview Vercel projesinde yalnızca preview/test amacıyla yayınlanır. Mevcut canlı site, Cyber Lion projesi, özel domainler ve canlı entegrasyonlar bu preview'dan bağımsızdır.
