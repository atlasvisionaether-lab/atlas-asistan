---
name: claude-code-prompt-kitapligi
description: PRD yazma, CLAUDE.md üretme, plan modu, UI/UX briefi, kurulum planı, MCP sunucusu bağlama, veri tabanı bağlama, güvenlik denetimi, kök-neden debug, Playwright E2E testi, ölü kod temizliği, temiz git commit'leri ve tekrar eden işi skill'e dönüştürme için hazır iş akışları. Tetikleyiciler: "PRD yaz", "CLAUDE.md oluştur", "plan çıkar önce kod yazma", "implementation plan", "MCP server bağla", "veri tabanı bağla", "güvenlik taraması", "şu hatayı debug et", "E2E test yaz", "ölü kodu temizle", "commit'leri düzgün ayır", "bunu skill'e çevir".
---

# Claude Code prompt kitaplığı

13 tekrarlanabilir iş akışı. Tam metinler `references/promptlar.md` dosyasında —
ilgili işi yaparken oradaki maddeyi aç ve **köşeli parantezli alanları gerçek
proje bilgisiyle doldurarak** uygula.

| # | İş | Ne zaman |
|---|---|---|
| 01 | PRD yazdır | Yeni özellik; kapsam ve başarı ölçütü belirsiz |
| 02 | CLAUDE.md oluştur | Repo Claude için belgelenmemiş |
| 03 | Ultra plan modu | Kod yazmadan önce risk ve alternatif haritası |
| 04 | UI/UX tasarım briefi | Ekran/akış tasarımı, token ve state envanteri |
| 05 | Kurulum planı | Onaylı PRD'yi doğrulanabilir adımlara bölme |
| 06 | MCP sunucusu bağla | Yeni servis/API entegrasyonu |
| 07 | Veri tabanı bağla | Şema, migration, erişim kuralları |
| 08 | Güvenlik açıklarını bul | Yetkili olduğun kod tabanında denetim |
| 09 | Debug et | Hata var, kök neden bilinmiyor |
| 10 | E2E test yaz | Playwright ile ana akış kapsaması |
| 11 | Ölü kodu temizle | Kullanılmayan kod, bağımlılık, flag |
| 12 | Temiz git commit'leri | Karışık staged değişiklikleri ayırma |
| 13 | Görevi skill'e dönüştür | Aynı işi üçüncü kez yapıyorsan |

## Hepsinde geçerli kurallar

- **Köşeli parantezler doldurulur.** `[FEATURE]`, `[YOUR STACK]` gibi alanlar
  gerçek değerle değişmeden prompt uygulanmaz; bilgi yoksa kullanıcıya sor.
- **Kanıt zorunlu.** Bu promptların ortak omurgası "yaptım" demek yerine
  çalıştırıp göstermek: örnek istek + yanıt, geçen test çıktısı, ekran görüntüsü.
- **Kritik değişikliklerde dur.** Auth, ödeme, prod verisi, migration ve yeni
  bağımlılık içeren adımlarda plan ve diff onaylanmadan ilerleme.
- **Sırra dikkat.** API anahtarı prompta veya koda yazılmaz; environment
  variable kullanılır. Denetim promptu yalnızca inceleme yetkisi olan kod
  tabanlarında çalıştırılır.

## Yerleşik araçlarla örtüşme

Bazı maddelerin Claude Code'da hazır karşılığı var — önce onu tercih et,
kitaplıktaki metni ek kontrol listesi olarak kullan:

- **02 CLAUDE.md** → `/init`
- **03 Plan modu** → yerleşik plan modu (EnterPlanMode)
- **08 Güvenlik** → `/security-review`
- **11 Ölü kod / temizlik** → `/simplify`, inceleme için `/code-review`
- **13 Skill'e dönüştür** → `skill-creator` skill'i

## Kullanım kalıbı

1. Tablodan işi seç.
2. `references/promptlar.md` içinden ilgili maddeyi aç.
3. Köşeli parantezleri doldur.
4. Uygula, sonucu kanıtla, kanıt yoksa "bitti" deme.

---

Kaynak: "13 Güçlü Claude Code Promptu · Prompt Rehberi" — talhaunuvai.
