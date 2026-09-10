---
name: deploy-verify
description: Preview dağıtımında kimlik akışını (kayıt, e-posta onayı, giriş, devir, çıkış, şifre sıfırlama) uçtan uca doğrular. Auth kodu değiştiğinde veya bir preview dağıtımının gerçekten çalıştığı kanıtlanacağında kullan.
---

# Preview doğrulaması (kimlik akışı)

`prod-verify` üretime bakar ve hesap **oluşturmaz**. Bu iş akışı tam tersini
yapar: gerçek hesap açar ve **gerçek e-posta gönderir**. Bu yüzden yalnızca
elle, yalnızca preview'a karşı koşulur.

- İş akışı: `.github/workflows/preview-verify.yml` (`workflow_dispatch`)
- Betik: `cyberlionai/tools/preview-verify.sh`

## İki faz, iki ayrı çalışma

Onay e-postası bir insanın posta kutusuna gider; tek bir çalışmada beklenemez.

**1. faz** — `phase1_run_id` boş bırakılır. Anonim tarama + kayıt koşar, onay
e-postası gider. Çerezler ve üretilen test şifresi artefakt olarak saklanır.

**2. faz** — `phase1_run_id` doldurulur (1. fazın çalışma numarası). Faz seçimi
`token_hash`'e değil **`phase1_run_id`'ye** bağlıdır; çünkü kullanıcı onay
bağlantısına tarayıcıdan tıkladıysa token tükenmiş olur ve elde `token_hash`
kalmaz.

- `token_hash` doluysa: `/api/auth/verify` üzerinden onay doğrulanır.
- `token_hash` boşsa: `/api/auth/login` üzerinden koşar. Bu eşdeğerdir, çünkü
  `cyberlionai/api/auth/login.js` de `claimForUser` çağırır — devir mantığı
  aynı kod yolundan geçer. İkinci bir test hesabı ve ikinci bir e-posta
  açmaya gerek yoktur.

Test şifresi bilerek workflow **girdisi değildir**: `workflow_dispatch` girdileri
çalışma sayfasında açıkça görünür. Şifre 1. fazda üretilir, artefakta yazılır,
log'da maskelenir, artefakt bir gün sonra silinir.

## SSO koruması kapatılmaz

Preview'da Vercel SSO koruması **açık kalır**. İstekler "Protection Bypass for
Automation" ile geçer. Betik iki biçimi de dener:

- `x-vercel-protection-bypass` başlığı,
- `?x-vercel-protection-bypass=...&x-vercel-set-bypass-cookie=samesitenone`
  sorgu biçimi (bu `_vercel_jwt` çerezini kurar).

Yanıt 302 ile `vercel.com/sso-api`'ye gidiyorsa bypass reddedilmiştir. Neredeyse
her zaman GitHub secret'ı ile Vercel'deki değer uyuşmuyordur. Betik değerin
uzunluğunu ve `Location` başlığını raporlar — tahmin etme, o raporu oku.

GitHub secret'ına yapıştırılırken sona kaçan satır sonu bypass'ı sessizce
geçersiz kılar; betik bu yüzden değerdeki tüm boşlukları temizler.

## CI'da Supabase/Upstash secret'ı yok

Betik yalnızca uygulamanın kendi HTTP uçlarıyla konuşur. Veritabanı doğrulaması
ve test kullanıcısının temizliği ayrıca, Supabase yönetim erişimi olan taraftan
yapılır. CI'ya veritabanı anahtarı **konmaz**.

## Koşudan sonra

Test hesabı preview'da kalır. Temizlenmesi kullanıcının açık onayıyla yapılır.
Kullanıcı silmeyi onayladığında `auth.users` satırının silinmesi
`ON DELETE CASCADE` sayesinde tarama kayıtlarını, kimlikleri ve oturumları da
düşürür (`004_scans_user_fk.sql`); bu ölçülmüş ve doğrulanmıştır.

## `workflow_dispatch` 404 alıyorsan

Bir iş akışı **varsayılan dalda kayıtlı değilse** hiçbir dalda tetiklenemez.
Yeni bir iş akışı eklediysen önce onu `main`'e merge et; sonra istediğin ref
üzerinde tetikleyebilirsin. Bu tuzağa bu projede iki kez düşüldü.
