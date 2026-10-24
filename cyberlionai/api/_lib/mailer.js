'use strict';

/**
 * İşlem e-postası gönderimi (Resend REST API).
 *
 *   send({ to, subject, text, html }) → { ok: true, id } | { ok: false, code }
 *   isConfigured()
 *
 * Paket yok: Resend'in belgelenmiş HTTP ucu `fetch` ile çağrılıyor
 * (POST https://api.resend.com/emails, Authorization: Bearer <anahtar>).
 *
 * KAPALI DEVRE: RESEND_API_KEY ya da MAIL_FROM yoksa HİÇ istek atılmaz ve
 * { ok: false, code: 'mail_unconfigured' } döner. Çağıran bunu hata saymaz;
 * kullanıcıya "e-posta gönderilemedi, sertifikanız ekranda" der.
 *
 * GÖNDEREN ALAN ADI: MAIL_FROM'daki alan adı (ör. bildirim@cyberlionai.com)
 * Resend panelinde doğrulanmış olmalı (SPF + DKIM kayıtları). Doğrulanmadan
 * Resend 403 döner.
 *
 * GİZLİLİK: alıcı adresi ve gövde hiçbir loga yazılmaz; hata loguna yalnızca
 * HTTP durumu gider. Anahtar yalnızca başlıkta.
 */

const ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = 8000;
const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,253}\.[a-z]{2,}$/i;

function config() {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || key.length < 10 || !from) return null;
  return { key: key, from: from, replyTo: process.env.MAIL_REPLY_TO || 'destek@cyberlionai.com' };
}

function isConfigured() { return config() !== null; }

async function send(msg) {
  const cfg = config();
  if (!cfg) return { ok: false, code: 'mail_unconfigured' };
  const to = msg && typeof msg.to === 'string' ? msg.to.trim() : '';
  if (!EMAIL_RE.test(to)) return { ok: false, code: 'mail_bad_recipient' };
  if (!msg.subject || !(msg.text || msg.html)) return { ok: false, code: 'mail_bad_message' };

  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Authorization': 'Bearer ' + cfg.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: cfg.from, to: [to], reply_to: cfg.replyTo,
        subject: String(msg.subject).slice(0, 200),
        text: msg.text || undefined, html: msg.html || undefined
      })
    });
  } catch (err) {
    return { ok: false, code: 'mail_unreachable' };
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    if (console && console.error) console.error('mail rejected', res.status);
    return { ok: false, code: 'mail_http_' + res.status };
  }
  let id = null;
  try { id = (await res.json()).id || null; } catch (e) { id = null; }
  return { ok: true, id: id };
}

/** HTML'e giden her değer kaçışlanır (kod sunucudan gelse de). */
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

const SCOPE_TR = { account: 'Hesap ve hesaba bağlı tüm veriler', conversations: 'Asistan konuşmaları', scans: 'Tarama geçmişi' };

/**
 * Silme sertifikası e-postası. İçerik: kod, kapsam, tarih, doğrulama adresi.
 * Silinen verinin kendisi e-postaya GİRMEZ.
 */
function certificateEmail(code, scopes, when) {
  const date = new Date(when || Date.now()).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const kapsam = (scopes || []).map(function (s) { return SCOPE_TR[s] || s; }).join(', ');
  const url = 'https://www.cyberlionai.com/silme-sertifikasi?code=' + encodeURIComponent(code);
  const text = [
    'Merhaba,',
    '',
    'Cyber Lion AI\'daki silme talebiniz tamamlandı.',
    '',
    'Silme Sertifikası: #' + code,
    'Kapsam: ' + kapsam,
    'Tarih: ' + date,
    '',
    'Sertifikayı şu adreste doğrulayabilirsiniz: ' + url,
    '',
    'Sertifika kişiye bağlı değildir: kodu bilen kişi silmenin yapıldığını görebilir, kimin yaptığını göremez.',
    'Bu e-postayı bu sertifikayı size iletmek için gönderdik; adresiniz bu amaçla başka bir yerde saklanmaz.',
    '',
    'Cyber Lion AI · destek@cyberlionai.com'
  ].join('\n');
  const html = '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#111">'
    + '<p>Merhaba,</p><p>Cyber Lion AI\'daki silme talebiniz tamamlandı.</p>'
    + '<table style="border-collapse:collapse;margin:12px 0">'
    + '<tr><td style="padding:4px 12px 4px 0;color:#555">Silme Sertifikası</td><td><strong style="font-family:monospace;font-size:17px">#' + esc(code) + '</strong></td></tr>'
    + '<tr><td style="padding:4px 12px 4px 0;color:#555">Kapsam</td><td>' + esc(kapsam) + '</td></tr>'
    + '<tr><td style="padding:4px 12px 4px 0;color:#555">Tarih</td><td>' + esc(date) + '</td></tr></table>'
    + '<p><a href="' + esc(url) + '">Sertifikayı doğrula</a></p>'
    + '<p style="color:#555;font-size:13px">Sertifika kişiye bağlı değildir: kodu bilen kişi silmenin yapıldığını görebilir, kimin yaptığını göremez. '
    + 'Bu e-postayı bu sertifikayı size iletmek için gönderdik; adresiniz bu amaçla başka bir yerde saklanmaz.</p>'
    + '<p style="color:#555;font-size:13px">Cyber Lion AI · destek@cyberlionai.com</p></div>';
  return { subject: 'Silme Sertifikası #' + code + ' · Cyber Lion AI', text: text, html: html };
}

/**
 * Sertifikayı gönderir; kullanıcıya dönecek durum kodu:
 *   'sent' | 'unconfigured' | 'no_code' | 'failed'
 */
async function sendCertificate(to, code, scopes) {
  if (!code) return 'no_code';
  const m = certificateEmail(code, scopes);
  const r = await send({ to: to, subject: m.subject, text: m.text, html: m.html });
  if (r.ok) return 'sent';
  return r.code === 'mail_unconfigured' ? 'unconfigured' : 'failed';
}

const KIND_TR = {
  score_drop: function (d) { return 'Skor düştü: ' + Number(d.from) + ' → ' + Number(d.to); },
  ssl_expiry: function (d) {
    return Number(d.daysLeft) < 0
      ? 'SSL sertifikasının süresi ' + (-Number(d.daysLeft)) + ' gün önce doldu'
      : 'SSL sertifikasının bitmesine ' + Number(d.daysLeft) + ' gün kaldı';
  },
  domain_expiry: function (d) {
    return Number(d.daysLeft) < 0
      ? 'Alan adı kaydının süresi ' + (-Number(d.daysLeft)) + ' gün önce doldu'
      : 'Alan adı kaydının bitmesine ' + Number(d.daysLeft) + ' gün kaldı';
  },
  blacklist: function (d) { return 'Kara listede görünüyor (' + String(d.source || '') + ')'; },
  downtime: function (d) { return 'Site erişilemedi (' + String(d.reason || '') + ')'; },
  recovered: function () { return 'Site yeniden erişilebilir oldu'; },
  new_findings: function (d) { return 'Önceki taramada olmayan ' + Number(d.count) + ' yeni bulgu: ' + String(d.first || ''); }
};

/**
 * Sabah özeti: son 24 saatte hesaba yazılan izleme uyarıları.
 * YALNIZCA ölçülen olaylar yazılır (skor, sertifika, kara liste, erişim,
 * yeni bulgu). "Engellenen saldırı" ya da "eklenti güncellemesi" gibi
 * ölçmediğimiz bir şey ASLA yazılmaz: müşterinin sunucusuna ve loglarına
 * erişimimiz yok.
 */
function digestEmail(alerts) {
  const byDomain = {};
  (alerts || []).forEach(function (a) {
    (byDomain[a.domain] = byDomain[a.domain] || []).push(a);
  });
  const domains = Object.keys(byDomain).sort();
  const critical = (alerts || []).filter(function (a) { return a.severity === 'critical'; }).length;
  const line = function (a) { return (KIND_TR[a.kind] ? KIND_TR[a.kind](a.data || {}) : a.kind); };

  const textParts = ['Günaydın,', '', 'Son 24 saatte günlük izlemenin sitelerinizde bulduğu ' + alerts.length + ' olay'
    + (critical ? ' (' + critical + ' kritik)' : '') + ':', ''];
  let html = '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#111"><p>Günaydın,</p>'
    + '<p>Son 24 saatte günlük izlemenin sitelerinizde bulduğu <strong>' + alerts.length + ' olay</strong>'
    + (critical ? ' (<strong style="color:#b00020">' + critical + ' kritik</strong>)' : '') + ':</p>';
  domains.forEach(function (d) {
    textParts.push(d);
    html += '<p style="margin:14px 0 4px"><strong>' + esc(d) + '</strong></p><ul style="margin:0;padding-left:20px">';
    byDomain[d].forEach(function (a) {
      textParts.push('  - ' + line(a) + (a.severity === 'critical' ? ' [KRİTİK]' : ''));
      html += '<li>' + esc(line(a)) + (a.severity === 'critical' ? ' <strong style="color:#b00020">[KRİTİK]</strong>' : '') + '</li>';
    });
    html += '</ul>';
    textParts.push('');
  });
  const panel = 'https://www.cyberlionai.com/dashboard#notifications';
  textParts.push('Ayrıntılar ve düzeltme adımları panelinizde: ' + panel, '',
    'Bu özet, aboneliğinizdeki günlük izleme hizmetinin bildirimidir. Sitelerinizi dışarıdan, pasif olarak tarıyoruz; sunucunuza ve loglarınıza erişimimiz yoktur.',
    '', 'Cyber Lion AI · destek@cyberlionai.com');
  html += '<p><a href="' + panel + '">Panelde ayrıntıları gör</a></p>'
    + '<p style="color:#555;font-size:13px">Bu özet, aboneliğinizdeki günlük izleme hizmetinin bildirimidir. Sitelerinizi dışarıdan, pasif olarak tarıyoruz; sunucunuza ve loglarınıza erişimimiz yoktur.</p>'
    + '<p style="color:#555;font-size:13px">Cyber Lion AI · destek@cyberlionai.com</p></div>';
  return {
    subject: (critical ? '⚠️ ' : '') + 'Sabah güvenlik özeti: ' + alerts.length + ' olay · Cyber Lion AI',
    text: textParts.join('\n'), html: html
  };
}

module.exports = { send, isConfigured, certificateEmail, sendCertificate, digestEmail, esc, EMAIL_RE };
