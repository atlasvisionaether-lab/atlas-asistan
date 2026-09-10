---
name: prod-verify
description: Cyber Lion AI üretim ortamını (www.cyberlionai.com) doğrular. Bir üretim dağıtımından, env değişkeni değişikliğinden, promote/rollback işleminden veya "üretimde çalışıyor mu" sorusundan sonra kullan.
---

# Üretim doğrulaması

Üretim yalnızca **gerçek genel HTTP yolu** üzerinden doğrulanır. Üretime geçici
uç, geçici log veya geçici kod eklenmez.

## Önce alias'ı doğrula — bu adım atlanamaz

Vercel'de bir üretim dağıtımı alan adı alias'ını **tutmaya devam edebilir**,
daha yeni üretim dağıtımları alias'sız beklerken. Bu bir kez gerçek bir kesintiye
yol açtı: iki env değişkeni düzeltildi, ~20 dağıtım yapıldı, hiçbiri trafiğe
çıkmadı çünkü alias eski bir dağıtıma sabitlenmişti; düzeltmelerin hiçbiri
ölçülemedi.

Bu yüzden her doğrulama koşusundan **önce**:

- `mcp__Vercel__get_deployment` çağır, `idOrUrl: "www.cyberlionai.com"`.
- Dönen dağıtımın commit SHA'sı ve oluşturulma zamanı, doğrulamak istediğin
  dağıtımla eşleşiyor mu bak.
- Eşleşmiyorsa **doğrulamayı koşma**. Kullanıcıya alias'ın hangi eski dağıtımda
  sabit kaldığını söyle ve promote istemesini bekle. Alias yanlışsa test
  sonuçları eski kodu ölçer ve yanıltır.

## Doğrulamayı koşma

Geliştirme ortamının giden bağlantısı `cyberlionai.com` ve `*.vercel.app`
adreslerini engeller. **Tek yol GitHub Actions'tır.**

- İş akışı: `.github/workflows/prod-verify.yml` (`workflow_dispatch`)
- Girdi: `base` (varsayılan `https://www.cyberlionai.com`)
- Betik: `cyberlionai/tools/prod-verify.sh`

`mcp__github__actions_run_trigger` ile tetikle, sonra `mcp__github__get_job_logs`
ile işin log'unu oku. Her PASS/FAIL satırını oku — sonuç kodu tek başına yeterli
değil.

## Betiğin ölçtüğü 10 bölüm

1. Gerçek tarama sonucu ve ücretsiz kota (oturum A)
2. Kota aşımı (6. tarama)
3. İkinci anonim oturum (B) — kendi kotası
4. Geçmiş — yalnızca kendi oturumunun kayıtları
5. PDF raporu
6. Oturumlar arası erişim — 404 beklenir
7. IP hız sınırı
9. Kimlik doğrulama (üretimde hesap **oluşturmadan**)
10. İstemciye secret sızmıyor
8. Temizlik — bırakılan tüm kayıtlar siliniyor (en sonda koşar)

## Kalıcı iz bırakma

Koşu 12 gerçek tarama yapar. Hedef **sabittir ve yalnızca kendi alan adımızdır**
(`cyberlionai.com`). Üçüncü taraf alan adı taranmaz. Ürettiği her kayıt 8. bölümde
gerçek silme ucuyla temizlenir ve geçmişin boşaldığı ayrıca doğrulanır. 8. bölüm
FAIL verirse üretimde test kaydı kalmıştır — bunu kullanıcıya açıkça bildir.

Üretimde **hesap oluşturulmaz**. Kimlik akışının uçtan uca testi preview'da
yapılır (`deploy-verify` skill'i).

## Teşhis yöntemi: nereye yazıldığını kanıtla

"Yanlış ortama bağlı" şüphesinde yapılandırma iddiasına güvenme. Her iki Supabase
projesinde de tarama tablosunun satır sayısını ve `max(scanned_at)` değerini
koşudan **önce ve sonra** ölç; yazının hangi projeye düştüğü böyle kanıtlanır.
Bu yöntem bu projede iki ayrı yanlış-ortam vakasını çözdü.

`/api/auth/me` `available: false` dönüyorsa bu Supabase'in erişilemez olduğunu
**değil**, bir env değişkeninin gerçekten eksik olduğunu kanıtlar:
`cyberlionai/api/_lib/auth.js` yalnızca env varlığına bakar, ağa çıkmaz.

## Sınırlar

- Üretim env değişkeni ekleme/değiştirme/silme, üretim dağıtımı ve merge
  **açık kullanıcı onayı** gerektirir.
- Secret değerlerini sohbete yazma, log'a düşürme veya ön yüze koyma.
- Eski projedeki gerçek kullanıcının verisi test için kullanılmaz, silinmez.
