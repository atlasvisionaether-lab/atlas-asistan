'use strict';

/**
 * Cyber Lion Asistan sınaması (api/assistant.js + data/knowledge.json).
 *
 * Sabitlenen kararlar:
 *   - Aynı soru, hangi geçmişle gelirse gelsin, aynı kanonik cevabı alır.
 *   - Bilgi tabanındaki her kanonik soru (TR ve EN) kendi niyetine gider.
 *   - Eşik altı soru uzmana yönlenir; selam/teşekkür yönlenmez.
 *   - Yanıtlanamayan soru Telegram'a bir kez gider, e-posta maskeli.
 *   - Asistandaki uzman formu /api/contact'ta "İnsan desteği" başlığı alır.
 *
 * Ağ yok: depo, oturum ve fetch saplanıyor.
 */

const path = require('node:path');
const Module = require('node:module');

const API = path.join(__dirname, '..', 'api');
const KB = require(path.join(__dirname, '..', 'data', 'knowledge.json'));

let gecti = 0;
const hatalar = [];
function dogru(ad, kosul) { if (kosul) { gecti += 1; return; } hatalar.push(ad); }
function esit(ad, bulunan, beklenen) {
  if (bulunan === beklenen) { gecti += 1; return; }
  hatalar.push(ad + ' (beklenen ' + JSON.stringify(beklenen) + ', bulunan ' + JSON.stringify(bulunan) + ')');
}

function sapla(gorecelYol, govde) {
  const tam = require.resolve(path.join(API, gorecelYol));
  const m = new Module(tam, null);
  m.filename = tam; m.loaded = true; m.exports = govde;
  require.cache[tam] = m;
}

function resSahte() {
  const res = {
    statusCode: 200, body: null, headers: {}, headersSent: false,
    setHeader: function (k, v) { res.headers[k] = v; },
    status: function (c) { res.statusCode = c; return res; },
    json: function (b) { res.body = b; res.headersSent = true; return res; },
    end: function () { res.headersSent = true; return res; }
  };
  return res;
}

/* Telegram'a giden metinleri toplayan fetch saplaması. */
const giden = [];
global.fetch = async function (adres, secenek) {
  giden.push(JSON.parse(secenek.body).text);
  return { ok: true, status: 200, json: async function () { return { ok: true }; } };
};
process.env.TELEGRAM_BOT_TOKEN = '7851234567:AAH9xKq-Zm3Rn4pQw7sTvB2cDeFgHiJkLmN';
process.env.TELEGRAM_CHAT_ID = '-1001234567890';

const kilitler = {};
let hizSayaci = 0;
sapla('_lib/store.js', {
  isConfigured: function () { return true; },
  hitRateLimit: async function (k) {
    if (k.indexOf('cl:rl:assist:') === 0) { hizSayaci += 1; return { count: hizSayaci, ttl: 60 }; }
    return { count: 1, ttl: 60 };
  },
  setOnce: async function (k) { if (kilitler[k]) return false; kilitler[k] = true; return true; }
});
sapla('_lib/session.js', {
  clientIp: function () { return '203.0.113.9'; },
  ipKey: function (ip) { return ip; }
});

const asistan = require(path.join(API, 'assistant.js'));
const contact = require(path.join(API, 'contact.js'));

async function kos() {
  /* ---------- bilgi tabanı biçimi ---------- */
  const ids = Object.keys(KB.intents);
  dogru('en az 10 niyet', ids.length >= 10);
  ids.forEach(function (id) {
    const v = KB.intents[id];
    ['tr', 'en'].forEach(function (dil) {
      dogru(id + '.' + dil + ' soru ve cevap var', v[dil] && v[dil].q && v[dil].a);
      dogru(id + '.' + dil + ' emoji yok', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(JSON.stringify(v[dil])));
    });
    (v.related || []).forEach(function (r) { dogru(id + ' ilişkili niyet var: ' + r, !!KB.intents[r]); });
    ['strong', 'weak'].forEach(function (tur) {
      (v.keywords[tur] || []).forEach(function (k) {
        esit(id + ' anahtar kelime sadeleşmiş: ' + k, asistan.normalize(k), k);
      });
    });
  });
  KB.greeting.concat(KB.fallbackSuggestions).forEach(function (id) {
    dogru('öneri niyeti var: ' + id, !!KB.intents[id]);
  });

  /* ---------- her kanonik soru kendi niyetine gider ---------- */
  ids.forEach(function (id) {
    ['tr', 'en'].forEach(function (dil) {
      const r = asistan.decide({ message: KB.intents[id][dil].q, lang: dil });
      esit('kanonik soru → ' + id + ' (' + dil + ')', r.intent, id);
    });
  });

  /* ---------- gerçekçi sorular ---------- */
  const ornekler = [
    ['planlar ne kadar', 'pricing'], ['Pro kaç TL?', 'pricing'], ['What do the plans cost?', 'pricing'],
    ['enterprise ne içeriyor', 'pricing'], ['Sonuçlar ne kadar güvenilir?', 'accuracy'],
    ['ücretsiz mi', 'free'], ['kayıt olmam gerekiyor mu', 'free'],
    ['sitemi nasıl tararım', 'scan'], ['CSP nasıl eklerim', 'csp'],
    ['sertifikam geçersiz diyor', 'tls'], ['verilerimi silebilir misiniz', 'privacy'],
    ['rakibimin sitesini tarayabilir miyim', 'authorization'], ['raporu pdf indirebilir miyim', 'report'],
    ['destek ekibine nasıl ulaşırım', 'contact'], ['telefon numaranız', 'contact'],
    ['iframe içinde açılıyor sitem', 'xframe'], ['cookie samesite ayarı', 'cookies'],
    ['merhaba fiyatlar nedir', 'pricing']
  ];
  ornekler.forEach(function (o) {
    esit('örnek: ' + o[0], asistan.decide({ message: o[0], lang: 'tr' }).intent, o[1]);
  });
  esit('"protokol" fiyatı tetiklemiyor (kısa kelime birebir)',
    asistan.decide({ message: 'protokol pro', lang: 'tr' }).score < 1, true);

  /* ---------- aynı soru → aynı cevap (geçmiş ne olursa olsun) ---------- */
  const SORU = 'İnsan bir uzmanla konuşmak istiyorum';
  const r1 = asistan.decide({ message: SORU, lang: 'tr', history: [] });
  const r2 = asistan.decide({ message: SORU, lang: 'tr', history: [
    { role: 'user', text: SORU }, { role: 'bot', text: 'contact' },
    { role: 'user', text: 'fiyatlar' }, { role: 'bot', text: 'pricing' }] });
  esit('uzman sorusu → contact', r1.intent, 'contact');
  esit('ikinci soruş aynı cevap', JSON.stringify(r2), JSON.stringify(r1));
  esit('uzman sorusu insan formunu açar', r1.handoff, true);
  dogru('cevap destek@ adresini içeriyor', r1.answer.a.indexOf('destek@cyberlionai.com') !== -1);
  dogru('cevap destek saatlerini içeriyor', r1.answer.a.indexOf('09:00') !== -1);
  esit('EN aynı niyet', asistan.decide({ message: 'I want to talk to a human', lang: 'en' }).intent, 'contact');
  dogru('EN cevap İngilizce', /Support hours/.test(asistan.decide({ message: SORU, lang: 'en' }).answer.a));

  /* ---------- düğme: niyet doğrudan ---------- */
  const dugme = asistan.decide({ intent: 'pricing', lang: 'tr' });
  esit('düğme niyeti', dugme.intent, 'pricing');
  esit('düğme puanı 1', dugme.score, 1);
  esit('düğme cevabı kanonik', dugme.answer.a, KB.intents.pricing.tr.a);
  esit('bilinmeyen dil TR\'ye düşer', asistan.decide({ intent: 'free', lang: 'de' }).answer.a, KB.intents.free.tr.a);

  /* ---------- bağlam ---------- */
  const tek = asistan.decide({ message: 'peki örnek kod?', lang: 'tr' });
  esit('bağlamsız takip sorusu → fallback', tek.type, 'fallback');
  const bagli = asistan.decide({ message: 'peki örnek kod?', lang: 'tr',
    history: [{ role: 'user', text: 'CSP nasıl eklenir?' }, { role: 'bot', text: 'csp' }] });
  esit('bağlamlı takip sorusu → csp', bagli.intent, 'csp');
  esit('bağlamlı işaretli', bagli.contextual, true);
  const sahte = asistan.decide({ message: 'peki?', lang: 'tr',
    history: [{ role: 'bot', text: 'csp fiyat insan' }] });
  esit('bot satırı bağlam sayılmıyor', sahte.type, 'fallback');

  /* ---------- acil, selam, bilinmeyen ---------- */
  esit('aktif olay → urgent', asistan.decide({ message: 'sitem hacklendi yardım', lang: 'tr' }).type, 'urgent');
  esit('EN aktif olay → urgent', asistan.decide({ message: 'my site was hacked', lang: 'en' }).type, 'urgent');
  const selam = asistan.decide({ message: 'merhaba', lang: 'tr' });
  esit('selam → smalltalk', selam.type, 'smalltalk');
  esit('selam uzmana yönlenmez', selam.handoff, false);
  esit('teşekkür → smalltalk', asistan.decide({ message: 'teşekkürler', lang: 'tr' }).type, 'smalltalk');
  const bilinmez = asistan.decide({ message: 'iade nasıl yapılır', lang: 'tr' });
  esit('bilinmeyen → fallback', bilinmez.type, 'fallback');
  esit('fallback uzmana yönlenir', bilinmez.handoff, true);
  dogru('fallback öneri veriyor', bilinmez.suggestions.length > 0);

  /* ---------- uç: Telegram ---------- */
  giden.length = 0;
  const istek = function (govde) { return { method: 'POST', body: govde, headers: {}, query: {} }; };
  let res = resSahte();
  await asistan(istek({ message: 'iade nasıl yapılır, mailim ali.veli@ornek.com', lang: 'tr' }), res);
  esit('fallback 200', res.statusCode, 200);
  esit('fallback Telegram\'a bir mesaj', giden.length, 1);
  dogru('Telegram mesajında tam e-posta yok', giden[0].indexOf('ali.veli@ornek.com') === -1);
  dogru('Telegram mesajında maskeli e-posta var', giden[0].indexOf('a***@ornek.com') !== -1);
  res = resSahte();
  await asistan(istek({ message: 'iade nasıl yapılır, mailim ali.veli@ornek.com', lang: 'tr' }), res);
  esit('aynı bilinmeyen soru ikinci kez bildirilmiyor', giden.length, 1);

  giden.length = 0;
  await asistan(istek({ message: 'Planlar ne kadar?', lang: 'tr' }), resSahte());
  await asistan(istek({ message: 'merhaba', lang: 'tr' }), resSahte());
  esit('cevaplanan soru ve selam bildirilmiyor', giden.length, 0);

  await asistan(istek({ message: 'sitem hacklendi', lang: 'tr' }), resSahte());
  esit('aktif olay bildiriliyor', giden.length, 1);
  dogru('aktif olay mesajı', /Asistan: olası aktif olay/.test(giden[0] || ''));

  res = resSahte();
  await asistan(istek({ lang: 'tr' }), res);
  esit('boş mesaj 400', res.statusCode, 400);

  res = resSahte();
  await asistan({ method: 'GET', query: { lang: 'en' }, headers: {} }, res);
  esit('GET öneriler 200', res.statusCode, 200);
  esit('GET öneriler karşılama listesi', res.body.suggestions.map(function (s) { return s.id; }).join(),
    KB.greeting.join());
  esit('GET öneriler EN', res.body.suggestions[0].q, KB.intents[KB.greeting[0]].en.q);

  hizSayaci = 999;
  res = resSahte();
  await asistan(istek({ message: 'fiyat', lang: 'tr' }), res);
  esit('hız sınırı 429', res.statusCode, 429);
  hizSayaci = 0;

  /* ---------- /api/contact: asistan kaynağı ---------- */
  giden.length = 0;
  res = resSahte();
  await contact({ method: 'POST', headers: {}, query: {},
    body: { name: 'Ali', email: 'ali@ornek.com', message: 'İnsan bir uzmanla konuşmak istiyorum', source: 'assistant' } }, res);
  esit('asistan talebi 200', res.statusCode, 200);
  dogru('asistan talebi "İnsan desteği" başlığıyla', /İnsan desteği istendi/.test(giden[0] || ''));
  res = resSahte();
  await contact({ method: 'POST', headers: {}, query: {},
    body: { name: 'Ali', email: 'ali@ornek.com', message: 'Merhaba' } }, res);
  dogru('olağan form başlığı değişmedi', /İletişim formu/.test(giden[1] || ''));

  if (hatalar.length) {
    console.error('\nAsistan sınaması: ' + hatalar.length + ' KALDI, ' + gecti + ' geçti\n');
    hatalar.forEach(function (h) { console.error('  ✗ ' + h); });
    process.exit(1);
  }
  console.log('Asistan sınaması: ' + gecti + ' / ' + gecti + ' geçti');
}

kos().catch(function (err) {
  console.error('sınama çöktü:', err && err.stack || err);
  process.exit(1);
});
