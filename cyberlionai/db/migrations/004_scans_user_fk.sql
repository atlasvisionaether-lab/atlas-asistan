-- =============================================================================
-- Cyber Lion AI — 004: cl_scans.user_id → auth.users(id) yabancı anahtarı
--
-- Neden: Aşama 3A'ya kadar giriş sistemi yoktu ve user_id serbest bir UUID
-- sütunuydu. Artık gerçek kullanıcılara işaret ediyor. Yabancı anahtar olmadan
-- iki sorun kalırdı:
--   1. Hesap silindiğinde tarama kayıtları öksüz kalır ve kimseye ait olmayan
--      veri olarak tabloda birikir.
--   2. Var olmayan bir kullanıcıya işaret eden satır yazılabilir; veritabanı
--      bunu engellemez, yalnızca uygulama katmanına güvenilmiş olur.
--
-- ON DELETE CASCADE: kullanıcı hesabını sildiğinde taramaları da silinir.
-- KVKK açısından da doğru davranış — hesap silme talebi veriyi gerçekten
-- ortadan kaldırmalı.
--
-- Anonim kayıtlar etkilenmez: user_id NULL olan satırlarda yabancı anahtar
-- kontrolü uygulanmaz (SQL standardı: NULL referans doğrulanmaz).
--
-- Geri alma: db/migrations/004_scans_user_fk_down.sql
-- =============================================================================

BEGIN;

-- Uygulama öncesi durum kaydı: bu satırların hiçbiri etkilenmemeli.
DO $$
DECLARE
  anon_count INT;
  user_count INT;
BEGIN
  SELECT count(*) INTO anon_count FROM public.cl_scans WHERE anonymous_session_id IS NOT NULL;
  SELECT count(*) INTO user_count FROM public.cl_scans WHERE user_id IS NOT NULL;
  RAISE NOTICE 'Migration 004 öncesi: % anonim kayıt, % kullanıcı kaydı', anon_count, user_count;

  -- Kısıt eklenmeden önce öksüz satır var mı? Varsa migration durmalı;
  -- sessizce veri silmek yerine sorunu görünür kılıyoruz.
  IF EXISTS (
    SELECT 1 FROM public.cl_scans s
     WHERE s.user_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = s.user_id)
  ) THEN
    RAISE EXCEPTION 'cl_scans içinde auth.users''ta karşılığı olmayan user_id var; '
                    'migration durduruldu. Önce bu satırlar incelenmeli.';
  END IF;
END $$;

ALTER TABLE public.cl_scans
  ADD CONSTRAINT cl_scans_user_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id)
  ON DELETE CASCADE;

COMMENT ON CONSTRAINT cl_scans_user_fk ON public.cl_scans IS
  'Hesap silindiğinde taramaları da silinir (KVKK: silme talebi veriyi '
  'gerçekten ortadan kaldırmalı). Anonim kayıtlarda user_id NULL olduğu için '
  'kısıt uygulanmaz.';

COMMIT;
