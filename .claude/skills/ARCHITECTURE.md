# CyberLion AI — hedef mimari (referans, henüz tam kurulu değil)

Bu dosya yalnızca bir **referans/niyet diyagramıdır** — aşağıdaki akışların
hepsi bugün çalışır durumda değil. Hangi parçanın gerçek, hangisinin
hedef olduğu her blokta ayrıca not edildi. Yeni kod yazmadan önce bu
dosyayı güncel kod ile karıştırma; `cyberlionai/` içindeki gerçek dosyalar
her zaman otoritedir.

## Akışlar

```
[User Form / Mail]
   -> /api/contact (Vercel Edge)
   -> telegram-ops skill -> @cyber_lion_ai_bot
   -> [Supabase: leads tablosu]

[Scan Request]
   -> security-core skill -> scanner.ts -> score
   -> seo-growth skill -> /blog otomatik içerik
   -> telegram-ops -> "Yeni tarama: xyz.com - 85 puan"

[Ödeme]
   -> iyzico-payment skill -> callback -> Supabase + Telegram
```

## Mevcut durum (gerçek kod neyi karşılıyor)

| Diyagramdaki parça | Gerçek karşılığı | Durum |
| --- | --- | --- |
| `/api/contact` | `cyberlionai/api/contact.js` | **Var.** Vercel Node serverless fonksiyonu (Edge runtime değil). |
| `telegram-ops` → bot bildirimi | `cyberlionai/api/_lib/telegram.js` | **Var.** Tarama, DNS doğrulama, hata ve iletişim formu bildirimleri çalışıyor. |
| Supabase `leads` tablosu | — | **Yok.** `/api/contact` bilinçli olarak hiçbir şeyi kalıcı depoya yazmıyor (bkz. dosyanın başındaki yorum). Eklenecekse ayrı bir migration gerekir. |
| `security-core` → `scanner.ts` | `cyberlionai/api/_lib/scanner.js` | **Var ama farklı isim/dil.** `.ts` değil `.js` — bu repoda derleme adımı yok. |
| `seo-growth` → `/blog` otomatik içerik | — | **Yok.** `/blog` dizini veya otomatik içerik üretim scripti yok. |
| `iyzico-payment` → `/api/payment/init`, `/api/payment/callback` | — | **Yok.** Şu an tek canlı ödeme-öncesi adım `checkout.html`'deki ön kayıt (waitlist) formu; gerçek iyzico ödeme ucu kurulmadı. |

## Bu dosyayı kullanırken

- Yeni bir özellik isteği bu diyagramdaki bir kutuyla eşleşiyorsa, önce
  yukarıdaki tabloya bakıp gerçekten var olanı bulun; yoksa sıfırdan
  kurulması gerektiğini varsayın.
- `.claude/skills/*/SKILL.md` dosyalarındaki teknoloji isimleri (Next.js,
  shadcn, bun, Supabase leads) bu hedef mimariye ait — bugünkü
  `cyberlionai/` kod tabanıyla birebir eşleşmeyebilir.
