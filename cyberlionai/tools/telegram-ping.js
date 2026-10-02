#!/usr/bin/env node
'use strict';

/**
 * Telegram bağlantısının elle denenmesi:
 *
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... \
 *     node cyberlionai/tools/telegram-ping.js "CyberLion canlı test OK"
 *
 * Neden ayrı bir betik: ortam değişkenleri doğru mu, sohbet kimliği doğru mu
 * ve bot gruba gerçekten yazabiliyor mu — bunların üçü de ancak GERÇEK bir
 * mesajla anlaşılıyor. Bu betik yayına hiçbir şey eklemiyor, CI'da koşmuyor
 * (ağ gerektiriyor) ve belirteci hiçbir yere yazmıyor.
 *
 * Çıkış kodu 0 = mesaj gitti, 1 = gitmedi (sebep stderr'de, belirteç gizli).
 */

const tg = require('../api/_lib/telegram.js');

async function kos() {
  if (!tg.isConfigured()) {
    console.error('TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID gerekli '
      + '(belirteç biçimi "<sayı>:<~35 karakter>").');
    process.exit(1);
  }

  const metin = process.argv.slice(2).join(' ') || 'CyberLion canlı test OK';
  const sonuc = await tg.sendTelegram(tg.mesaj.test(metin), { type: 'alert' });

  if (!sonuc.ok) {
    console.error('gönderilemedi: ' + sonuc.code + ' ' + (sonuc.status || 0));
    process.exit(1);
  }
  console.log('gönderildi: ' + tg.mesaj.test(metin));
}

kos().catch(function (err) {
  console.error('çöktü: ' + tg.gizle(err && err.message));
  process.exit(1);
});
