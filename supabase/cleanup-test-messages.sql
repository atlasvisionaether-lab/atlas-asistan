-- ============================================================
-- Test mesajlarını temizle (tek seferlik; migration değildir).
-- Supabase SQL Editor'de çalıştırılır.
--
-- customer_id = 6e37b8e0-fdce-4837-ab1a-f11b7578c198 için
-- 'Selam fiyat nedir?' test INSERT'lerinden gelen müşteri
-- mesajlarını VE bunların tetiklediği AI cevaplarını siler.
--
-- Adım 1: önce silecekleri gör (güvenlik).
-- Adım 2: DELETE'i çalıştır.
--
-- NOT: Bu müşteriye ait gerçek konuşmalar da varsa Adım 1'de
-- içerikten ayırt et; gerekirse DELETE koşuluna content/date ekle.
-- ============================================================

-- ADIM 1: Önizleme (silinecek satırlar)
select id, sender_type, is_from_customer, channel, content, created_at
from public.messages
where customer_id = '6e37b8e0-fdce-4837-ab1a-f11b7578c198'
order by created_at;

-- ADIM 2: Temizlik
-- a) Test müşteri mesajları:
delete from public.messages
where customer_id = '6e37b8e0-fdce-4837-ab1a-f11b7578c198'
  and is_from_customer = true
  and content = 'Selam fiyat nedir?';

-- b) Bu testlerin ürettiği AI cevapları (trigger kurulmadan önce
--    elle atılmış 'Lazer Epilasyon: 1500 TL' tipi cevaplar dahil):
delete from public.messages
where customer_id = '6e37b8e0-fdce-4837-ab1a-f11b7578c198'
  and is_from_customer = false
  and sender_type = 'ai';

-- c) Doğrulama (0 satır dönmeli; gerçek eski mesajlar hariç):
select count(*) as kalan_test
from public.messages
where customer_id = '6e37b8e0-fdce-4837-ab1a-f11b7578c198'
  and content = 'Selam fiyat nedir?';
