-- ============================================================
-- 0006: first-touch uyumu için customers.full_name nullable.
-- Bu dosya Supabase'de uygulanır; GitHub kopyası referans amaçlıdır.
-- Kök sebep: 0001 şemasında full_name NOT NULL idi; fakat Edge Function
--   first-touch akışı (4B-2.ii) isimsiz müşteri kaydeder (müşteri henüz
--   isim vermemiş, sadece WhatsApp'tan yazmış). Çelişki webhook'ta
--   "null value in column full_name violates not-null constraint" patlattı.
--   phone/email zaten nullable; full_name'in NOT NULL olması tutarsızdı.
--   KVKK uyumu: izin/isim zorlamadan kayıt. İdempotent (DROP NOT NULL no-op).
-- ============================================================

ALTER TABLE public.customers ALTER COLUMN full_name DROP NOT NULL;
