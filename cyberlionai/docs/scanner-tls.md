# TLS kontrolleri: ne ölçülüyor, ne ölçülmüyor

Motor: `api/_lib/scanner.js` (`inspectTls`, `probeLegacyTls`) ölçüyor,
`api/_lib/engines/tls-scanner.js` yorumluyor. Üç kontrol var ve **sayısı
artmadı**: `tls_protocol`, `tls_cert`, `tls_legacy`.

## Sertifika başarısızlığının sebebi adlandırılıyor

`tls_cert` eksik zinciri, süresi geçmişi ve güvenilmeyen kökü **zaten
yakalıyordu** — ama üçüne de aynı şeyi söylüyordu. Not alanına OpenSSL'in ham
hata kodu yazılıyordu (`certNote = t.authorizationError`); sözlükte karşılığı
olmadığı için müşteri raporunda şu görünüyordu:

```
UNABLE_TO_VERIFY_LEAF_SIGNATURE
```

ve düzeltme metni "sertifikayı yenileyin" idi. **O tavsiye eksik ara sertifika
için yanlış:** yenileme sorunu çözmez, zinciri tam göndermek çözer.

Artık sebep ayrılıyor ve her birinin kendi düzeltmesi var:

| not | ne demek | düzeltmenin özü |
| --- | --- | --- |
| `chain_incomplete` | ara sertifika eksik | `fullchain.pem` (cert.pem değil) |
| `expired` | süresi geçmiş | yenile + yenilemeyi otomatikleştir |
| `self_signed` | kendinden imzalı | tanınan bir makamdan sertifika |
| `hostname_mismatch` | bu alan adı için düzenlenmemiş | SAN listesine adı ekle |
| `revoked` | iptal edilmiş | **yeni anahtarla** yeni sertifika |
| `expiring_soon` | <15 gün | yenilemeyi bekleme |
| `untrusted` | tanınmayan bir doğrulama hatası | kontrolün genel metni |

Ölçüm (koşu `38167648017`, 11.10.2026) iki şeyi kanıtladı:

```
incomplete-chain.badssl.com → UNABLE_TO_VERIFY_LEAF_SIGNATURE, zincir 1
expired.badssl.com          → CERT_HAS_EXPIRED,                zincir 3
cyberlionai.com             → doğrulandı,                      zincir 4
atlasasistan.com            → doğrulandı,                      zincir 5
google.com                  → doğrulandı,                      zincir 3
```

1. Zincir uzunluğu kullanılabilir bir göstergedir: **Node zinciri yerel kök
   deposundan tamamlamıyor**, yoksa eksik zincirli sunucuda da 3+ görürdük.
   Bu yüzden hata kodu tanınmadığında zincir uzunluğu 1 ise "eksik zincir"
   deniyor — tahmin değil, ölçülmüş bir gösterge.
2. `CERT_HAS_EXPIRED` ile zincir sorunu farklı şeyler: süresi geçmiş sunucunun
   zinciri tamdı (3).

**Skora etkisi yok:** yeni kontrol kimliği eklenmedi, `pass`/`fail` kararı
değişmedi, ağırlıklar aynı. Değişen tek şey müşterinin okuduğu metin.
Motor sürümü `1.4.0-owasp-lite` olarak kaldı.

## OCSP stapling kontrolü YAZILMADI — gerekçe

Aynı ölçümde (koşu `38167648017`):

| sunucu | makam | OCSP yanıtı |
| --- | --- | --- |
| digicert.com | DigiCert | **471 bayt** |
| cyberlionai.com | Let's Encrypt | yok |
| www.cyberlionai.com | Let's Encrypt | yok |
| atlasasistan.com | Let's Encrypt | yok |
| google.com | Google Trust Services | yok |

**Ölçüm çalışıyor** — DigiCert gerçek bir yanıt stapled ediyor, yani "yok"
sonuçları bir ölçüm hatası değil. Ama Let's Encrypt 2025'te OCSP yanıtlarını
kullanımdan kaldırdı ve Google Trust Services de stapling yapmıyor. Yani:

> "Stapling yok → başarısız" diyen bir kontrol, web'in büyük kısmını ve
> **kendi sitemizi** haksız yere cezalandırırdı.

Bilgi satırı olarak yazmak da reddedildi: raporu uzatır ve müşteriye
yapabileceği bir şey vermez. Karar, ölçüm olmadan verilemezdi — bu yüzden
ölçüm kontrolden önce yapıldı.

Ölçüm sırasında betiğin kendisinde de bir kusur bulundu: Node'un
`'OCSPResponse'` olayı **stapling olmadığında da tetikleniyor**, yalnızca
gövdesi 0 bayt oluyor. İlk sürüm boolean'a bakıyordu ve stapling yapmayan beş
sunucuya "VAR" diyordu. Ölçüt artık gövde uzunluğu; DigiCert'in 471 baytıyla
karşılaştırma bu kusuru ortaya çıkardı.

## Yazılmayan diğer iki kontrol

**Anahtar gücü** (`RSA < 2048`, `EC < 256`): ölçülebiliyor (`bits` çıktıda
var — yaprak sertifikalar 2048 RSA ya da 256 bit prime256v1), ama on yıldır
hiçbir makam zayıf anahtar kesmiyor. Her sitede `pass` çıkacak bir satır
rapora bilgi eklemez.

**30 günlük erken uyarı:** bugün `<15 gün` zaten `fail`. Otomatik yenileme
kullanan sitelerde (bizim ikisi dahil) 30 günlük uyarı gürültüdür.

İkisi de ölçüm sonucuna göre bilinçli olarak **yazılmadı**; sebep burada
yazılı olduğu için ileride yeniden tartışılabilir.

## Ölçümü tekrarlama

```
feeds-probe.yml → cert_detail: true, dns_domains: "<alan adları>"
```

Geliştirme kabından koşmaz (çıkış kapalı); `tools/cert-detail-probe.js`
o durumda tahmin etmez, `ÖLÇÜLEMEDİ` der.

## Sınamalar

`tools/certcause-test.js` — 27 doğrulama, ağ gerektirmez. Ölçülmüş
fikstürleri, her sebebin ayrı adlandırıldığını, **ham OpenSSL kodunun nota
sızmadığını**, kontrol kimliği sayısının değişmediğini ve her sebebin hem
arayüzde hem PDF'te çevirisi + düzeltmesi olduğunu tutuyor.
