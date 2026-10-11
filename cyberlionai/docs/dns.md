# DNS kayıtları — cyberlionai.com

Bu belge **kendi** alan adımızın DNS durumunu tutuyor. Taradığımız müşteri
alan adlarıyla ilgisi yok; onlar `api/_lib/mail.js` ve `api/_lib/caa.js` ile
ölçülüyor.

Kaynak: üretim taraması `prod-verify` koşusu `38160655530` (11.10.2026),
hedef `https://www.cyberlionai.com`. Satırlar motorun kendi çıktısı:

| Kontrol | Durum | Anlamı |
|---|---|---|
| `spf` | PASS | kayıt var ve ayrıştırıldı |
| `dmarc` | PASS | kayıt var ve ayrıştırıldı |
| `dkim` | PASS | en az bir seçici bulundu |
| `dnssec` | FAIL | bölge imzasız (ölçüldü) |
| `caa` | SKIP (`not_implemented`) | **kayıt yok** (ölçüldü, sorgu çalıştı) |

Beşinin de ağırlığı `info` (0). Skoru etkilemiyorlar; kalibrasyon sınamasının
8. bölümü bunu söz olarak tutuyor (CAA'lı, CAA'sız ve boş CAA'lı üç bağlam
aynı skoru veriyor).

## CAA: MX düzelene kadar yalnızca `issue`

Eklenecek kayıt, **tek satır**:

```
Type: CAA   Name: @   Value: 0 issue "<makamın CAA kimliği>"
```

`iodef` satırı **şimdilik eklenmiyor**. İki sebep:

1. `cyberlionai.com`'un **MX kaydı yok**. `security@`, `info@` ve `destek@`
   bugün mail **alamıyor**; `mailto:` biçimindeki bir `iodef` ihlal
   bildirimlerini hiçbir yere göndermez. MX geldikten sonra eklenir —
   ya da `mailto:` yerine bir `https://` bildirim adresi kullanılır
   (RFC 8659 ikisine de izin veriyor).
2. `iodef` **yetki vermiyor**: yalnızca `issue` ve `issuewild` bir makamı
   yetkilendirir. Yani `iodef`'in gecikmesi korumayı geciktirmiyor.

### Makam adı ölçülmeden yazılmaz

`<makamın CAA kimliği>` yukarıda bilinçli olarak **boş**. Yanlış makamı
yazmak, Vercel'in otomatik yenilemesini kırar ve site sertifikasız kalır.
"Vercel genelde Let's Encrypt veriyor" bir tahmindir ve CAA kaydı tahminle
yazılmaz.

Vercel API'si makamı **döndürmüyor** (`/v5/certs`, `/v7/certs/<id>` → yalnızca
`cns`, `createdAt`, `expiresAt`, `autoRenew`; 11.10.2026'da bakıldı), bu yüzden
TLS el sıkışması gerekiyor:

```
bash cyberlionai/tools/cert-issuer-probe.sh cyberlionai.com www.cyberlionai.com
```

Geliştirme kabından koşmaz (çıkış `cyberlionai.com:443`'ü kapatıyor, CONNECT
403), bu yüzden `feeds-probe.yml` iş akışına `cert_issuer` girdisiyle bağlı.

CAA'ya yazılacak ad, sertifikadaki issuer CN'i **değil**, makamın CAA
kimliğidir: Let's Encrypt → `letsencrypt.org`, Google Trust Services →
`pki.goog`, Sectigo → `sectigo.com`.

## DNSSEC

`dnssec` FAIL = bölge imzasız. Ölçüm doğru; bu bir arıza değil, kapalı bir
katman. Açmak alan adı sağlayıcısının (bugün Vercel DNS) tarafında bir iş ve
`caa` ile aynı sınıfta: ağırlık `info` (0), skora etkisi yok.

Raporda `dnssec`'in "Kaldı", `caa`'nın "Uygulanmamış" görünmesi bilinen bir
tutarsızlık; ikisi de aynı sınıfta olduğu için **bilinçli olarak öyle
bırakıldı**.
