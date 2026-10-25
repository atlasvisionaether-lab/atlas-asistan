-- =============================================================================
-- Atlas Asistan — 0019: karşılama ve mesai dışı mesajı otomatik cevapta
--
-- atlas-auto-reply artık:
--   - yeni müşteriye BİR KEZ assistant_settings.greeting_message gönderir;
--     "bir kez" customers.greeted_at ile tutulur (koşullu güncelleme, atomik);
--   - mesai dışında assistant_settings.after_hours_message gönderir (boşsa
--     fallback_message).
--
-- after_hours_message paneldeki Otomasyonlar ekranı tarafından zaten yazılıyordu
-- ama repoda migration'ı yoktu; IF NOT EXISTS ile kayda geçirildi.
--
-- Geriye dönük: bu migration'dan ÖNCE cevap almış (giden mesajı olan)
-- müşteriler "karşılandı" sayılır — süren konuşmanın ortasında
-- "Merhaba, ben Atlas Asistan" gitmesin. Tekrar çalıştırmak güvenli: yalnız
-- giden mesajı olan müşterileri işaretler.
-- =============================================================================

BEGIN;

ALTER TABLE public.assistant_settings ADD COLUMN IF NOT EXISTS after_hours_message text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS greeted_at timestamptz;

UPDATE public.customers c
   SET greeted_at = coalesce(c.created_at, now())
 WHERE c.greeted_at IS NULL
   AND EXISTS (SELECT 1 FROM public.messages m WHERE m.customer_id = c.id AND m.direction = 'out');

COMMIT;
