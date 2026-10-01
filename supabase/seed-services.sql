-- ============================================================
-- Services temizlik + seed (FAZ 7 — tek seferlik, migration değildir).
-- Supabase SQL Editor'de çalıştırılır. İdempotent hedeflenmiştir.
-- Org: fff29ed3-f2e3-4837-bdfc-f4e974f366e7
-- ============================================================

-- 1) Önizleme: şimdi tabloda ne var?
select id, name, price, duration_min, is_active, created_at
from public.services
where organization_id = 'fff29ed3-f2e3-4837-bdfc-f4e974f366e7'
order by created_at;

-- 2) Temizlik: test/eski kayıtları sil.
--    'lazer genel', 'lazer kismi' ve 0 TRY'lık 'Danışmanlık' dahil,
--    Lazer Epilasyon / Cilt Bakımı dışındaki her şey bu org'dan kalkar.
delete from public.services
where organization_id = 'fff29ed3-f2e3-4837-bdfc-f4e974f366e7'
  and name not in ('Lazer Epilasyon', 'Cilt Bakımı');

-- 3) Seed: 2 temiz hizmet (yoksa ekle, varsa fiyat/süre/aktiflik güncelle).
--    Edge Function hizmet listesini her çağrıda okur; deploy gerekmez.
insert into public.services (organization_id, name, price, duration_min, is_active)
values
  ('fff29ed3-f2e3-4837-bdfc-f4e974f366e7', 'Lazer Epilasyon', 1500, 60, true),
  ('fff29ed3-f2e3-4837-bdfc-f4e974f366e7', 'Cilt Bakımı', 1200, 45, true)
on conflict (organization_id, name) do update
  set price = excluded.price,
      duration_min = excluded.duration_min,
      is_active = excluded.is_active;

-- NOT: "on conflict" için (organization_id, name) üzerinde unique kısıt/index gerekir.
-- Yoksa aşağıdaki alternatifi kullan (unique'suz ortam):
--
-- delete from public.services
-- where organization_id = 'fff29ed3-f2e3-4837-bdfc-f4e974f366e7';
-- insert into public.services (organization_id, name, price, duration_min, is_active)
-- values
--   ('fff29ed3-f2e3-4837-bdfc-f4e974f366e7', 'Lazer Epilasyon', 1500, 60, true),
--   ('fff29ed3-f2e3-4837-bdfc-f4e974f366e7', 'Cilt Bakımı', 1200, 45, true);

-- 4) Doğrulama: tam olarak 2 aktif satır dönmeli.
select name, price, duration_min, is_active
from public.services
where organization_id = 'fff29ed3-f2e3-4837-bdfc-f4e974f366e7'
order by name;
