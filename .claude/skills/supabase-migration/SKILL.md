---
name: supabase-migration
description: Cyber Lion AI veritabanı şema değişikliklerini yazar ve uygular. Yeni tablo, sütun, kısıt, indeks, RLS politikası veya GRANT değişikliği gerektiğinde kullan.
---

# Supabase migration yönetimi

Dizin: `cyberlionai/db/migrations/`

Aktif proje: `cyberlionai` / ref `aohsgagiyaseinhmyfub` (eu-central-1). Bu proje
`atlasvisionaether-lab` organizasyonuna taşındığı için `list_projects` çıktısında
görünmez; ref ile doğrudan sorgulanır. Eski proje `atlas-vision` /
`nqvuayhedqpgwftonesl` **kullanımda değil ve dokunulmaz**.

## Her migration'ın ikizi vardır

`NNN_ad.sql` yazan her seferinde `NNN_ad_down.sql` de yazılır. Geri alma dosyası
isteğe bağlı değil.

Mevcut seri: `001_remediation`, `002_support`, `003_scan_history`,
`003b_tighten_grants`, `004_scans_user_fk` — hepsinin `_down` ikizi var.

## Dosya biçimi

```sql
-- =============================================================================
-- Cyber Lion AI — NNN: kısa başlık
--
-- Neden: bu değişikliğin çözdüğü somut sorun. Değişikliğin ne yaptığını değil,
-- neden gerektiğini yaz — "ne"si zaten SQL'de görünüyor.
-- =============================================================================

BEGIN;

-- ... değişiklik ...

COMMIT;
```

Kurallar:

- Her zaman `BEGIN; ... COMMIT;` içinde. Yarım uygulanmış şema bırakma.
- `IF NOT EXISTS` / `IF EXISTS` kullan; migration yeniden koşulabilir olsun.
- Yorumlar Türkçe, gerekçe odaklı — depodaki mevcut üslupla aynı.
- Geri alma dosyası veri silmemeli. Yalnızca kısıt/indeks/politika kaldırmalı;
  veri kaybı gerekiyorsa bunu yorumda açıkça yaz.

## Uygulamadan önce

1. `mcp__Supabase__list_tables` ile mevcut yapıyı **oku**. Şemayı hatırdan yazma.
2. Değişikliği ve geri alma yolunu kullanıcıya anlat.
3. **Açık onay al.** Kalıcı üretim veritabanında `INSERT`/`UPDATE`/`DELETE`/
   `TRUNCATE`/`DROP` ve geri alınamaz migration'lar onay gerektirir. RLS
   politikası, `GRANT`/`REVOKE`, auth ayarı, redirect URL, e-posta sağlayıcı/SMTP
   değişiklikleri de aynı kapsamdadır.
4. Uygula: `mcp__Supabase__apply_migration`.
5. `mcp__Supabase__get_advisors` ile güvenlik ve başarım uyarılarını oku.

## Gizlilik, şema tasarımına dahildir

`cl_scans` bilerek **IP adresi ve konum bilgisi saklamaz**. Yalnızca normalize
edilmiş `host` tutulur. Yeni bir sütun eklerken sor: bu alan bir insanı
tanımlanabilir kılıyor mu? Kılıyorsa gerçekten gerekli mi?

`004_scans_user_fk` `ON DELETE CASCADE` ile gelir: hesap silindiğinde taramalar
da silinir. Bu KVKK açısından doğru davranıştır ve ölçülerek doğrulanmıştır
(1 kullanıcı + 3 tarama → 0 kullanıcı, 0 tarama, 0 kimlik, 0 oturum). Kullanıcıya
bağlı yeni tablolarda aynı davranışı koru.

## Başka uygulamaların verisine dokunma

Eski `atlas-vision` projesi başka uygulamalarla paylaşılıyordu ve oradaki bir
`handle_new_user()` tetikleyicisi tüm kayıtları engellemişti. Ayrışmanın sebebi
budur. Başka bir uygulamanın tablosunu, tetikleyicisini, fonksiyonunu veya
verisini değiştirmek ayrı ve açık onay gerektirir.

Gerekçe ve tam ayrışma günlüğü: `cyberlionai/docs/supabase-ayrisma.md`.
