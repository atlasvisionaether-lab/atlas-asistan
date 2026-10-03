/**
 * Gmail → Telegram bildirimi (Google Apps Script)
 *
 * info@cyberlionai.com kutusuna (destek@ aynı kutuya alias olarak düşüyor)
 * gelen HER yeni postada konu + gönderen + hangi adrese geldiğini Telegram'a
 * yazar. Mail'in kendisi Telegram'a GİTMEZ — yalnızca başlık bilgisi.
 *
 * KURULUM (bu depodan DEPLOY EDİLEMEZ — elle yapılır)
 *
 * 1. info@cyberlionai.com olarak https://script.google.com adresine git.
 * 2. "Yeni proje" oluştur, bu dosyanın içeriğini tek bir .gs dosyasına yapıştır.
 * 3. Sol menüden "Proje Ayarları" > "Script Properties" > şunları ekle:
 *      TELEGRAM_BOT_TOKEN = <BotFather'ın verdiği belirteç>
 *      TELEGRAM_CHAT_ID   = <bildirimin gideceği sohbet kimliği>
 * 4. Sol menüden "Tetikleyiciler" (saat simgesi) > "Tetikleyici ekle":
 *      Çalıştırılacak fonksiyon: checkNewMail
 *      Etkinlik kaynağı: Zamana dayalı
 *      Zamanlayıcı türü: Dakika zamanlayıcısı > her 5 dakikada bir
 * 5. İlk çalıştırmada Google bir yetki ekranı gösterir (Gmail okuma +
 *    dış servise istek atma). Yalnızca bu Apps Script projesi için, yalnızca
 *    info@ hesabının kendi izniyle.
 *
 * NEDEN "OKUNDU" DEĞİL ETİKET KULLANILIYOR
 *
 * Bir maili "okundu" işaretlemek insanın kendi okuma durumunu da değiştirir
 * — kullanıcı maili açıp okusa bile script onu "bildirilmedi" sanabilir ya da
 * tam tersi. Bunun yerine script kendi etiketini (TG-Bildirildi) kullanır:
 * yalnızca bu script neyi işlediğini bilir, insan gelen kutusunu istediği
 * gibi okuyup okumadan bırakabilir.
 */

var ETIKET_ADI = 'TG-Bildirildi';
var MAX_UZUNLUK = 300;

function checkNewMail() {
  var etiket = GmailApp.getUserLabelByName(ETIKET_ADI) || GmailApp.createLabel(ETIKET_ADI);
  var konular = GmailApp.search('in:inbox -label:' + ETIKET_ADI, 0, 20);

  for (var i = 0; i < konular.length; i++) {
    var konu = konular[i];
    var mesajlar = konu.getMessages();
    var sonMesaj = mesajlar[mesajlar.length - 1];

    var basligaGelen = aliciAdresi(sonMesaj);
    var metin = '[CyberLion] 📬 Yeni mail (' + basligaGelen + ')\n'
      + 'Konu: ' + kisalt(konu.getFirstMessageSubject()) + '\n'
      + 'Gönderen: ' + kisalt(sonMesaj.getFrom());

    gonderTelegram(metin);
    konu.addLabel(etiket);
  }
}

/** "To"/"Delivered-To" başlığından hangi adrese geldiğini okur. */
function aliciAdresi(mesaj) {
  var alici = (mesaj.getTo() || '').toLowerCase();
  if (alici.indexOf('destek@') !== -1) return 'destek@cyberlionai.com';
  if (alici.indexOf('info@') !== -1) return 'info@cyberlionai.com';
  return alici || 'bilinmiyor';
}

function kisalt(s) {
  s = String(s || '');
  return s.length > MAX_UZUNLUK ? s.slice(0, MAX_UZUNLUK - 1) + '…' : s;
}

function gonderTelegram(metin) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TELEGRAM_BOT_TOKEN');
  var chatId = props.getProperty('TELEGRAM_CHAT_ID');
  if (!token || !chatId) {
    Logger.log('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID Script Properties\'te tanımlı değil.');
    return;
  }

  var url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  try {
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        chat_id: chatId,
        text: metin,
        disable_web_page_preview: true
      }),
      muteHttpExceptions: true
    });
  } catch (err) {
    Logger.log('Telegram gönderimi başarısız: ' + err);
  }
}
