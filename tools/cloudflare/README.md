# Klinik siteleri için alt alan adı — Cloudflare kurulumu (bir kez)

Klinik siteleri Vercel'de `https://atlasasistan.com/s/<alt-alan>` adresinde sunulur (DNS gerekmez, hemen çalışır).
`<alt-alan>.atlasasistan.com` için Cloudflare'da iki adım:

1. **DNS → Kayıt ekle**: Tür `AAAA`, Ad `*`, IPv6 `100::`, **Proxy: Açık (turuncu bulut)**.
   (Adres önemsiz; istek Worker'a gider. Mevcut `www`/kök kayıtları etkilenmez — özel kayıtlar wildcard'dan önce gelir.)
2. **Workers & Pages → Oluştur → Worker**: adı `atlas-site-proxy`; içeriğe `site-proxy-worker.js`'i yapıştırıp **Deploy**.
   Ardından Worker → **Ayarlar → Tetikleyiciler → Rota ekle**: `*.atlasasistan.com/*`, bölge `atlasasistan.com`.

SSL: Cloudflare'ın ücretsiz Universal SSL sertifikası `*.atlasasistan.com`'u kapsar; ek işlem yok.

Deneme: panelde bir siteyi yayınladıktan sonra `https://<alt-alan>.atlasasistan.com` açılmalı;
yayınlanmamış adres "Bu adreste yayında bir site yok" sayfası verir.
