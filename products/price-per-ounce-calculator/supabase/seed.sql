-- Price Per Ounce Calculator — optional seed data
-- Example saved calculations so the dashboard is not empty on first run.

insert into public.calculations (product_slug, payload)
values
  ('price-per-ounce-calculator', '{"items":[{"label":"Brand A","price":4.99,"size":500,"unit":"g"},{"label":"Brand B","price":3.49,"size":12,"unit":"oz"}],"note":"seed example"}'),
  ('price-per-ounce-calculator', '{"items":[{"label":"Store brand","price":2.99,"size":1,"unit":"kg"},{"label":"Name brand","price":5.49,"size":1,"unit":"kg"}],"note":"seed example"}');
