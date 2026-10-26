'use strict';

/**
 * Kanal adaptör katmanı — ortak arayüz, türler ve kayıt.
 *
 * Her kanal (telegram.js, whatsapp.js, instagram.js) aynı arayüzü uygular:
 *
 * @typedef {'whatsapp'|'telegram'|'instagram'} ChannelType
 *
 * @typedef {Object} NormalizedMessage
 * @property {string} clinicId      kurum (organizations.id)
 * @property {ChannelType} channel
 * @property {string} from          kanaldaki gönderen kimliği (Telegram chat id, WhatsApp wa_id, Instagram IGSID)
 * @property {string} text
 * @property {number} timestamp     ms (Unix)
 * @property {unknown} raw          kanalın ham olayı
 * @property {string} [externalId]  kanalın mesaj kimliği (tekrar gelirse bir kez yazılır)
 * @property {string} [name]        gönderenin görünen adı (varsa)
 *
 * @typedef {Object<string,string>} ChannelCredentials
 *
 * @typedef {Object} ConnectResult
 * @property {boolean} success
 * @property {'connected'|'pending'|'error'} status
 * @property {string} [message]     kullanıcıya gösterilecek açıklama
 * @property {string} [webhookUrl]  Meta kanallarında uygulamaya girilecek adres
 * @property {string} [error]       hata kodu
 *
 * @typedef {Object} ChannelAdapter
 * @property {ChannelType} type
 * @property {(clinicId: string, credentials: ChannelCredentials) => Promise<ConnectResult>} connect
 * @property {(clinicId: string, input: {code: string, wabaId: string, phoneNumberId: string, coexistence: boolean}) => Promise<ConnectResult>} [connectEmbedded]  yalnız WhatsApp (Embedded Signup v4)
 * @property {(clinicId: string) => Promise<void>} disconnect
 * @property {(clinicId: string, to: string, text: string) => Promise<{ id?: string }>} sendMessage
 * @property {(req: WebhookRequest) => Promise<boolean>} verifyWebhook
 * @property {(payload: unknown, connection?: Connection) => NormalizedMessage|null} parseIncoming
 *           ilk metin mesajı (arayüzün tanımı); toplu olaylar için parseAll kullanılır
 * @property {(payload: unknown, connection: Connection) => NormalizedMessage[]} parseAll
 *           bir webhook gövdesindeki TÜM metin mesajları (Meta tek gövdede birden çok mesaj gönderebilir)
 *
 * @typedef {Object} WebhookRequest
 * @property {string} method
 * @property {Object<string,string>} headers
 * @property {Object<string,string>} query
 * @property {Buffer} raw           ham gövde (imza bunun üzerinden doğrulanır)
 * @property {Connection} connection  bağlantı (URL'deki ?c= ile bulunur)
 *
 * @typedef {Object} Connection     channel_connections satırı (secrets çözülmüş halde `creds`)
 *
 * Kurum izolasyonu: webhook adresi bağlantıya özel (?c=<id>); kurum kimliği
 * istekten değil bağlantı satırından gelir. Meta kanallarında gövdedeki numara/
 * sayfa kimliği de bağlantıyla karşılaştırılır.
 */

const TYPES = ['telegram', 'whatsapp', 'instagram'];

/* Kanal başına tek mesaj üst sınırı (karakter); uzun cevaplar parçalanır. */
const MAX_TEXT = { telegram: 4096, whatsapp: 4096, instagram: 1000 };

/** Metni kanal sınırına göre, mümkünse paragraf/cümle sınırından böler. */
function chunk(text, max) {
  const out = [];
  let rest = String(text || '').trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf('. ', max) + 1;
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max);
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Sağlayıcı hata nesnesi → kısa, loglanabilir kod (jeton içermez). */
class ChannelError extends Error {
  constructor(code, userMessage) {
    super(code);
    this.code = code;
    this.userMessage = userMessage || null;
  }
}

function registry() {
  return {
    telegram: require('./telegram.js'),
    whatsapp: require('./whatsapp.js'),
    instagram: require('./instagram.js')
  };
}

/** @returns {ChannelAdapter|null} */
function adapterFor(type) {
  return TYPES.indexOf(type) === -1 ? null : registry()[type];
}

module.exports = { TYPES, MAX_TEXT, chunk, ChannelError, adapterFor };
