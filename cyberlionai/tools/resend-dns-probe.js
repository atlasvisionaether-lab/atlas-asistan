'use strict';

/**
 * Resend gönderimi için DNS ön kontrolü (ağ gerektirir; CI'da koşmaz).
 *
 *   node cyberlionai/tools/resend-dns-probe.js [gönderen-adres]
 *   node cyberlionai/tools/resend-dns-probe.js hesap@cyberlionai.com
 *
 * NEDEN VAR
 *
 * cyberlionai.com'un DMARC kaydı KATI: `p=reject; adkim=s; aspf=s`.
 *   - aspf=s: Resend dönüş adresini (Return-Path) `send.<alan>` alt alan
 *     adından kullanır; katı SPF hizasında bu HİÇBİR ZAMAN hizalı sayılmaz.
 *     Yani DMARC'ı geçiren tek yol DKIM'dir.
 *   - adkim=s: DKIM imzasının alanı (d=) ile gönderen (From) alanı BİREBİR
 *     aynı olmalı. Resend `resend._domainkey.<alan>` ile imzalar; gönderen
 *     `hesap@cyberlionai.com` ise geçer, `hesap@mail.cyberlionai.com` ise
 *     geçmez ve p=reject yüzünden mail alıcı sunucuda REDDEDİLİR — Resend
 *     panelinde "gönderildi" görünür, kullanıcıya hiç ulaşmaz.
 *
 * Bu betik o sessiz arızayı kurulumdan ÖNCE yakalar. Hiçbir şey göndermez,
 * hiçbir şeyi değiştirmez; yalnızca herkese açık DNS kayıtlarını okur.
 */

const dns = require('node:dns').promises;

const from = (process.argv[2] || 'hesap@cyberlionai.com').trim().toLowerCase();
const m = from.match(/^[^@\s]+@([a-z0-9.-]+\.[a-z]{2,})$/);
if (!m) {
  console.error('Geçersiz gönderen adresi: ' + from);
  process.exit(2);
}
const fromDomain = m[1];

let kalan = 0;
function sonuc(ok, ad, ayrinti) {
  if (!ok) kalan += 1;
  console.log((ok ? '  GEÇTİ ' : '  KALDI ') + ad + (ayrinti ? ' — ' + ayrinti : ''));
}
function uyari(ad, ayrinti) { console.log('  UYARI ' + ad + (ayrinti ? ' — ' + ayrinti : '')); }

async function txt(name) {
  try { return (await dns.resolveTxt(name)).map(function (p) { return p.join(''); }); } catch (e) { return []; }
}
async function mx(name) {
  try { return await dns.resolveMx(name); } catch (e) { return []; }
}

/** Organizasyon alan adı: basit yaklaşım (son iki etiket); .com.tr gibi ikili
    TLD'ler için son üç. cyberlionai.com için yeterli. */
function orgDomain(d) {
  const p = d.split('.');
  const ikili = /^(com|net|org|gov|edu|gen|web|biz|info|av|dr|bel|k12|pol|tsk)\.[a-z]{2}$/.test(p.slice(-2).join('.'));
  return p.slice(ikili ? -3 : -2).join('.');
}

function dmarcTag(rec, tag) {
  const t = rec.split(';').map(function (s) { return s.trim(); })
    .find(function (s) { return s.toLowerCase().indexOf(tag + '=') === 0; });
  return t ? t.slice(tag.length + 1).trim().toLowerCase() : null;
}

async function main() {
  const org = orgDomain(fromDomain);
  console.log('Gönderen: ' + from + '  (alan: ' + fromDomain + ', organizasyon: ' + org + ')\n');

  console.log('DKIM (Resend imzası)');
  const dkim = await txt('resend._domainkey.' + fromDomain);
  const dkimKey = dkim.find(function (r) { return /\bp=[A-Za-z0-9+/=]{100,}/.test(r); });
  sonuc(Boolean(dkimKey), 'resend._domainkey.' + fromDomain, dkimKey ? 'anahtar var (' + dkimKey.length + ' karakter)' : 'kayıt yok ya da anahtar boş');

  console.log('Dönüş yolu (send.' + fromDomain + ')');
  const sendMx = await mx('send.' + fromDomain);
  sonuc(sendMx.length > 0, 'MX send.' + fromDomain, sendMx.map(function (r) { return r.exchange; }).join(', ') || 'yok');
  const sendSpf = (await txt('send.' + fromDomain)).find(function (r) { return /^v=spf1\b/i.test(r); });
  sonuc(Boolean(sendSpf), 'SPF send.' + fromDomain, sendSpf || 'yok');

  console.log('DMARC (' + org + ')');
  const dmarc = (await txt('_dmarc.' + org)).find(function (r) { return /^v=DMARC1\b/i.test(r); });
  if (!dmarc) {
    uyari('_dmarc.' + org, 'kayıt yok — teslim edilir ama sahteciliğe açık');
  } else {
    const p = dmarcTag(dmarc, 'p') || 'none';
    const adkim = dmarcTag(dmarc, 'adkim') || 'r';
    const aspf = dmarcTag(dmarc, 'aspf') || 'r';
    console.log('  BİLGİ  ' + dmarc);
    /* DKIM hizası: d=fromDomain. Katıda From birebir aynı alan olmalı; gevşekte
       aynı organizasyon yeter. Resend fromDomain ile imzaladığı için iki
       durumda da hizalıdır — yeter ki DKIM kaydı fromDomain'de dursun. */
    sonuc(Boolean(dkimKey), 'DKIM hizası (adkim=' + adkim + ')',
      dkimKey ? 'imza alanı = gönderen alanı' : 'DKIM yok: DMARC yalnızca SPF\'e kalır');
    /* SPF hizası: Return-Path send.fromDomain. Katıda hiçbir zaman hizalı değil. */
    const spfHizali = aspf !== 's';
    if (!spfHizali) uyari('SPF hizası (aspf=s)', 'Return-Path send.' + fromDomain + ' olduğu için SPF hizalanmaz; DMARC DKIM ile geçer. Normal.');
    if (!dkimKey && (p === 'reject' || p === 'quarantine')) {
      sonuc(false, 'DMARC sonucu', 'p=' + p + ' ve DKIM yok: e-postalar ' + (p === 'reject' ? 'REDDEDİLİR' : 'spam\'e gider'));
    } else {
      sonuc(true, 'DMARC sonucu', 'DKIM ile geçmesi beklenir (p=' + p + ')');
    }
    if (fromDomain !== org && adkim === 's') {
      uyari('Alt alan adından gönderim', 'adkim=s iken DKIM kaydı ' + fromDomain + ' üzerinde olmalı; ' + org + ' üzerindeki anahtar yetmez');
    }
  }

  console.log('Kök alan (bilgi)');
  const kokMx = await mx(org);
  console.log('  BİLGİ  MX ' + org + ': ' + (kokMx.map(function (r) { return r.exchange; }).join(', ') || 'yok') + ' (gelen posta; Resend etkilemez)');

  console.log('\n' + (kalan ? 'KALAN: ' + kalan + ' — Resend panelindeki kayıtları DNS sağlayıcısına ekleyin.' : 'TÜMÜ GEÇTİ — bu adresten Resend ile gönderim DMARC\'tan geçmeli.'));
  process.exit(kalan ? 1 : 0);
}

main().catch(function (e) { console.error(e); process.exit(2); });
