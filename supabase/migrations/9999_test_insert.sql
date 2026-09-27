-- 0012 test: müşteri mesajı ekle (webhook tetiklenir).
-- NOT: direction NOT NULL (0001) olduğundan 'in' verilmelidir.
insert into public.messages (
  organization_id, customer_id, content, channel,
  direction, is_from_customer, sender_type, unread
) values (
  'fff29ed3-f2e3-4837-bdfc-f4e974f366e7',
  '6e37b8e0-fdce-4837-ab1a-f11b7578c198',
  'Selam fiyat nedir?',
  'whatsapp',
  'in', true, 'customer', true
);

-- 3-5 sn sonra çalıştır — AI cevabı (sender_type='ai') gelmeli:
select sender_type, is_from_customer, content, created_at
from public.messages
where customer_id = '6e37b8e0-fdce-4837-ab1a-f11b7578c198'
order by created_at desc
limit 3;
