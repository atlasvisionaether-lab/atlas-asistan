'use strict';

/**
 * n8n webhook bildirici — fire-and-forget, ana akışı bloklamaz.
 *
 * Yapılandırma: N8N_WEBHOOK_BASE env değişkeni tanımlı değilse tüm
 * çağrılar sessizce atlanır (üretimde tunnel kurulmadıysa güvenli).
 *
 *   N8N_WEBHOOK_BASE=https://abc.ngrok.io/webhook   ← ngrok
 *   N8N_WEBHOOK_BASE=https://n8n.sirketim.com/webhook  ← kendi domain
 *
 * Vercel'den localhost:5678'e erişilemez; bu değişken ngrok/Cloudflare
 * Tunnel gibi bir tünel URL'si olmak zorundadır.
 */

const BASE = (process.env.N8N_WEBHOOK_BASE || '').replace(/\/$/, '');

function notify(path, data) {
  if (!BASE) return;
  const url = BASE + '/' + path;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(4000),
  }).catch(function () { /* n8n erişilemiyor, sessiz geç */ });
}

module.exports = { notify };
