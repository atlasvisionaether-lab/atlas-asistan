-- =============================================================================
-- Cyber Lion AI — 005: Telegram bildirim altyapısı
--
-- Neden kuyruk: bildirim, isteği yavaşlatmamalı ve Telegram'a ulaşılamaması
-- taramayı ya da kaydı bozmamalı. Olay kuyruğa yazılır, gönderim ayrı çalışır,
-- başarısızlık yeniden denenir.
--
-- GİZLİLİK — bu tablolar bilerek dar tutuldu:
--   * HAM IP HİÇBİR YERDE SAKLANMAZ. Yalnızca maskelenmiş biçim (88.120.x.x)
--     ve ülke kodu tutulur. Ham adres bellekte maskelenip atılır.
--   * Tam URL, path, query ve token saklanmaz — cl_scans ile aynı kural.
--   * E-posta ham saklanmaz; maskelenmiş biçim (ab***@ornek.com) tutulur.
--   * Her satırın son kullanma tarihi vardır; süresi geçen kayıt silinir.
--
-- Bu tablolar yurt dışına veri aktarımı ANLAMINA GELİR: Telegram'a gönderilen
-- her bildirim bir üçüncü tarafa aktarımdır. KVKK kapsamındaki yükümlülükler
-- (aydınlatma, açık rıza veya uygun aktarım mekanizması) uygulamanın değil
-- işletmenin sorumluluğundadır. Bu yüzden kişisel veri taşıyan bildirim
-- türleri VARSAYILAN OLARAK KAPALI gelir.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Ayarlar: tek satır. Hangi bildirim türü açık, hangi filtreler geçerli.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cl_telegram_settings (
  id                SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- Ana anahtar. Kapalıyken hiçbir bildirim kuyruğa bile girmez.
  enabled           BOOLEAN NOT NULL DEFAULT false,

  -- Kişisel veri TAŞIMAYAN türler: işletme/operasyon bildirimleri.
  notify_critical   BOOLEAN NOT NULL DEFAULT true,   -- sunucu hatası, hız sınırı, şüpheli etkinlik
  notify_payments   BOOLEAN NOT NULL DEFAULT true,   -- plan, tutar, durum
  notify_summary    BOOLEAN NOT NULL DEFAULT true,   -- günlük/haftalık toplu özet

  -- Kişisel veri TAŞIYAN türler. Varsayılan KAPALI; açmak işletmenin
  -- aydınlatma ve aktarım yükümlülüğünü üstlenmesi demektir.
  notify_visitors   BOOLEAN NOT NULL DEFAULT false,  -- ziyaretçi: maskelenmiş IP, ülke, sayfa
  notify_scans      BOOLEAN NOT NULL DEFAULT false,  -- tarama: hedef host, skor
  notify_auth       BOOLEAN NOT NULL DEFAULT false,  -- kayıt/giriş: maskelenmiş e-posta
  notify_assistant  BOOLEAN NOT NULL DEFAULT false,  -- asistan soruları
  notify_downloads  BOOLEAN NOT NULL DEFAULT false,  -- PDF indirmeleri

  -- Filtreler.
  only_country      TEXT,                            -- 'TR' → yalnızca o ülke; NULL → hepsi
  only_registered   BOOLEAN NOT NULL DEFAULT false,  -- yalnızca kayıtlı kullanıcılar
  only_paying       BOOLEAN NOT NULL DEFAULT false,  -- yalnızca ödeme yapanlar
  only_critical     BOOLEAN NOT NULL DEFAULT false,  -- yalnızca kritik olaylar

  -- Aynı türden bildirimler bu kadar saniye içinde TEK mesajda toplanır.
  -- Ziyaretçi bildirimi açıkken tek tek göndermek hem sohbeti kullanılmaz
  -- kılar hem Telegram sınırlarına takılır.
  batch_seconds     INTEGER NOT NULL DEFAULT 300 CHECK (batch_seconds BETWEEN 0 AND 86400),

  -- Kuyruk kaydının saklanma süresi.
  retention_days    SMALLINT NOT NULL DEFAULT 7 CHECK (retention_days BETWEEN 1 AND 90),

  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.cl_telegram_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.cl_telegram_settings IS
  'Telegram bildirim ayarları (tek satır). Kişisel veri taşıyan türler '
  'varsayılan olarak kapalıdır; açmak yurt dışına aktarım yükümlülüğü doğurur.';

-- ---------------------------------------------------------------------------
-- Kuyruk: gönderilecek bildirimler.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cl_telegram_queue (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind          TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'info'
                  CHECK (severity IN ('info', 'warning', 'critical')),

  -- Gönderilecek metin. HAM kişisel veri İÇERMEZ: üreten kod maskelenmiş
  -- değerler yazar (bkz. api/_lib/telegram.js maskIp / maskEmail).
  body          TEXT NOT NULL CHECK (length(body) <= 4096),

  -- Toplama anahtarı: aynı anahtara sahip bekleyen kayıtlar tek mesajda
  -- birleştirilir.
  batch_key     TEXT,

  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'failed', 'dropped')),
  attempts      SMALLINT NOT NULL DEFAULT 0,
  last_error    TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at       TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days'
);

CREATE INDEX IF NOT EXISTS cl_telegram_queue_pending_idx
  ON public.cl_telegram_queue (created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS cl_telegram_queue_expires_idx
  ON public.cl_telegram_queue (expires_at);

COMMENT ON TABLE public.cl_telegram_queue IS
  'Telegram bildirim kuyruğu. body maskelenmiş değerler içerir; ham IP veya '
  'ham e-posta yazılmaz. expires_at geçen kayıtlar silinir.';

-- ---------------------------------------------------------------------------
-- Etkinlik: /stats, /today, /week komutlarının beslendiği SAYIM tablosu.
--
-- Bilerek olay BAŞINA satır değil, gün+tür+ülke başına SAYAÇ. Ziyaretçi
-- başına satır tutmak, cl_scans'te bilerek kaçınılan şeyin ta kendisi olurdu.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cl_activity_counters (
  day           DATE NOT NULL,
  kind          TEXT NOT NULL,
  country       TEXT NOT NULL DEFAULT '',   -- NULL yerine bos dize: birincil anahtarda NULL eslesmez
  count         INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (day, kind, country)
);

COMMENT ON TABLE public.cl_activity_counters IS
  'Gün + tür + ülke başına sayaç. Ziyaretçi başına satır BİLEREK tutulmaz; '
  'bireysel iz bırakmadan /stats, /today ve /week beslenir.';

-- ---------------------------------------------------------------------------
-- Sayaç artırma. Tek çağrıda ekle-veya-artır; iki eşzamanlı istek arasında
-- yarış koşulu oluşmaz.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cl_bump_activity(
  p_day DATE, p_kind TEXT, p_country TEXT
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.cl_activity_counters (day, kind, country, count)
  VALUES (p_day, p_kind, COALESCE(p_country, ''), 1)
  ON CONFLICT (day, kind, country) DO UPDATE
    SET count = public.cl_activity_counters.count + 1;
$$;

REVOKE ALL ON FUNCTION public.cl_bump_activity(DATE, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Yalnızca service_role erişir; anon ve authenticated hiçbirine dokunamaz.
REVOKE ALL ON public.cl_telegram_settings  FROM anon, authenticated;
REVOKE ALL ON public.cl_telegram_queue     FROM anon, authenticated;
REVOKE ALL ON public.cl_activity_counters  FROM anon, authenticated;

ALTER TABLE public.cl_telegram_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cl_telegram_queue     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cl_activity_counters  ENABLE ROW LEVEL SECURITY;

COMMIT;
