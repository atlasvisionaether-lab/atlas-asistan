'use strict';

/**
 * GET /api/geo → ziyaretçinin ülke kodu (düz metin, ör. "TR").
 *
 * Ana sayfa, kullanıcı bir dil seçmediyse Türkiye'den gelenlere Türkçe açmak
 * için ülkeyi soruyor. Eskiden bu, tarayıcıdan ipapi.co'ya gidiyordu: her
 * ziyaretçinin IP adresi yurt dışındaki üçüncü bir servise aktarılıyordu ve
 * servis ücretsiz kotayı aşınca 429 dönüp konsolda CORS hatası üretiyordu.
 *
 * Vercel ülkeyi her isteğe zaten ekliyor (x-vercel-ip-country); burada yalnızca
 * o okunuyor. IP adresi hiçbir yere iletilmez, kaydedilmez, loglanmaz.
 * Ülke bilinmiyorsa 404: istemci tarayıcı dilinde kalır.
 */

module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }
  /* Yanıt ziyaretçiye özel: paylaşılan önbellekte (CDN) tutulmamalı. */
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Vary', 'x-vercel-ip-country');
  const raw = String((req.headers && req.headers['x-vercel-ip-country']) || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(raw)) return res.status(404).end();
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.status(200).send(raw);
};
