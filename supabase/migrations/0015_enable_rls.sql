-- =============================================================================
-- Atlas Asistan — 0015: satır güvenliğini (RLS) aç
--
-- Neden: 10 tabloda politikalar yazılmıştı ama RLS KAPALIYDI; politikalar hiç
-- uygulanmıyordu. anon rolünün bu tablolarda SELECT/INSERT/UPDATE yetkisi
-- vardı: tarayıcıya gömülü herkese açık (publishable) anahtarı bilen herkes
-- tüm salonların müşteri telefonlarını ve mesajlarını okuyup yazabiliyordu.
--
-- Etki analizi (2026-10-05, üretim, salt okuma):
--   - Son 24 saatte bu tablolara REST çağrısı yok; anon kullanan canlı
--     bütünleşme yok. Otomatik cevap (edge function) servis rolüyle çalışır,
--     RLS'ten etkilenmez; mesaj tetikleyicisi veritabanı içinde çalışır.
--   - Panel giriş yapmış kullanıcıyla çalışır; yazdığı her tablo için mevcut
--     politika kendi kurumuna izin veriyor.
--   - İki boşluk kapatıldı: `services` tablosunda hiç politika yoktu (RLS
--     açılınca panelin Hizmetler sayfası boş kalırdı) ve `users` yalnızca
--     kendi satırını gösteriyordu (Ekip sayfası yalnızca kişinin kendisini
--     gösterirdi). current_org_id() SECURITY DEFINER: users politikası kendi
--     tablosunu sorgulasa da özyineleme yok.
--   - anon yetkileri ayrıca geri alındı (RLS'e ek savunma).
-- =============================================================================

BEGIN;

-- Hizmetler: kurum üyeleri kendi kurumunun hizmetlerini yönetir.
DROP POLICY IF EXISTS services_tenant ON public.services;
CREATE POLICY services_tenant ON public.services FOR ALL TO authenticated
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

-- Kullanıcılar: aynı kurumdaki ekip arkadaşlarını görebilir (yalnızca okuma).
DROP POLICY IF EXISTS users_org_select ON public.users;
CREATE POLICY users_org_select ON public.users FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id());

ALTER TABLE public.organizations              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automations                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_settings_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.organizations, public.users, public.customers, public.messages,
  public.appointments, public.services, public.campaigns, public.automations,
  public.assistant_settings, public.assistant_settings_history FROM anon;

-- Yardımcı fonksiyonlar oturumsuz çağrılmasın (anon için zaten NULL/false döner).
REVOKE EXECUTE ON FUNCTION public.current_org_id() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_role(text[]) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(text[]) TO authenticated, service_role;

COMMIT;
