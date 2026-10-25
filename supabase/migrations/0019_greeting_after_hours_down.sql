-- 0019 geri alma: yalnız greeted_at kaldırılır. after_hours_message panelce
-- 0019'dan önce de kullanılıyordu; silinirse Otomasyonlar ekranı açılmaz.
BEGIN;
ALTER TABLE public.customers DROP COLUMN IF EXISTS greeted_at;
COMMIT;
