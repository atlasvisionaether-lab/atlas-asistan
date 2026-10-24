'use strict';

/**
 * Ücretsiz tek konulu araçlar (/araclar/*): güvenlik başlıkları ('headers')
 * ve e-posta kimlik doğrulaması ('email': SPF + DMARC).
 *
 * Tam taramanın KOPYASI değil: aynı motoru (engines/header-scanner.js) ve
 * aynı SSRF kapısını (scanner.guardedFetch → guard.assertPublicHost)
 * kullanır, ama yalnızca başlık kontrollerini döndürür ve en önemli
 * TOP_N bulguyu gösterir. Bütünü tam taramada. Gövde okunmaz (yalnız
 * yanıt başlıkları) — pasif seviye 1, sahiplik doğrulaması gerekmez.
 *
 * Kontrol mantığı burada DEĞİŞMEZ; puan yalnızca bu alt küme üzerinden
 * hesaplanır, bu yüzden tam taramanın puanıyla aynı olması beklenmez.
 */

const scanner = require('./scanner.js');
const headerEngine = require('./engines/header-scanner.js');
const { normalizeTarget } = require('./guard.js');
const { CHECKS } = require('./report.js');
const fixpricing = require('./fixpricing.js');
const mail = require('./mail.js');
const net = require('net');

const HEADER_IDS = ['https', 'hsts', 'csp', 'xframe', 'nosniff', 'referrer', 'permissions', 'disclosure'];
const TOP_N = 3;
const TYPES = ['headers', 'email'];

/** Bağlamdan (headers + finalUrl) araç sonucunu üretir. Saf: ağ yok. */
function headersReport(context) {
  const checks = headerEngine.analyze(context, 'tr').checks.filter(function (c) {
    return HEADER_IDS.indexOf(c.id) !== -1;
  });
  const failed = checks.filter(function (c) { return c.status === 'fail'; }).sort(function (a, b) {
    return (scanner.WEIGHTS[b.severity] - scanner.WEIGHTS[a.severity])
      || (HEADER_IDS.indexOf(a.id) - HEADER_IDS.indexOf(b.id));
  });
  const metin = CHECKS.tr;
  const top = failed.slice(0, TOP_N).map(function (c) {
    const m = metin[c.id] || [c.id, '', ''];
    return {
      id: c.id, severity: c.severity, detail: c.detail,
      name: m[0], risk: m[1], fix: m[2],
      fixPrice: fixpricing.TIERS[fixpricing.tierOf(c.id)]
    };
  });
  return {
    type: 'headers',
    host: context.finalUrl.hostname,
    score: scanner.scoreOf(checks),
    summary: {
      total: checks.length,
      pass: checks.filter(function (c) { return c.status === 'pass'; }).length,
      fail: failed.length
    },
    top: top,
    hiddenFailures: failed.length - top.length,
    checkedAt: new Date().toISOString()
  };
}

/* --- E-posta (SPF + DMARC) -----------------------------------------------
   Hedef siteye HİÇ istek gitmez: yalnızca genel DNS'e TXT sorgusu
   (mail.spfDmarcKayitlari — panelin alan adı doğrulamasıyla aynı yol). DKIM
   yok: seçici taraması 9 sorgu ister ve çoğu zaman yalnızca "bilinmiyor"
   diyebilir (bkz. mail.js başlığı).

   Değerlendirme mail.spfDegerlendir / dmarcDegerlendir'in AYNISI. Tek fark
   tam taramadan (engines/dns-scanner.js): kayıt boş ama sorgu TAMAMLANMADIYSA
   (zaman aşımı, SERVFAIL) "kayıt yok" denmez, "ölçülemedi" denir —
   verify-dns.js'teki gibi. */
const EMAIL_IDS = ['spf', 'dmarc'];

/* Not kodlarının açıklaması. Ana sayfadaki eşi: index.html → spf_missing… */
const NOT_METNI = {
  spf_missing: 'SPF kaydı yok — bu alan adı adına herkes e-posta gönderebilir.',
  spf_multiple: 'Birden fazla SPF kaydı var; alıcı sunucu hepsini geçersiz sayar.',
  spf_no_all: "Kayıt 'all' mekanizmasıyla bitmiyor; kapsam belirsiz.",
  spf_allows_all: "'+all' herkese bu alan adı adına gönderme yetkisi veriyor.",
  spf_neutral: "'?all' alıcıya hiçbir dayanak vermiyor.",
  dmarc_missing: 'DMARC kaydı yok — sahte e-posta engellenmiyor.',
  dmarc_monitor_only: 'p=none yalnızca izleme; sahte e-posta yine teslim ediliyor.',
  dmarc_partial: 'pct 100 değil; politika iletilerin yalnızca bir kısmına uygulanıyor.',
  dmarc_no_policy: 'Kayıtta p= yok; DMARC geçersiz.',
  dmarc_multiple: 'Birden fazla DMARC kaydı var; alıcı sunucu DMARC uygulamaz.',
  not_measured: 'DNS sorgusu tamamlanamadı; kaydın olup olmadığını bilmiyoruz. Biraz sonra tekrar deneyin.'
};

/* Nota özel düzeltme; yoksa report.js'teki genel öneri kullanılır. */
const NOT_DUZELTME = {
  spf_multiple: 'SPF kayıtlarını TEK bir TXT kaydında birleştirin: v=spf1 include:<sağlayıcı 1> include:<sağlayıcı 2> -all',
  spf_no_all: "Kaydın sonuna -all (veya geçiş döneminde ~all) ekleyin.",
  spf_allows_all: "Kayıttaki +all ifadesini -all (veya geçiş döneminde ~all) ile değiştirin.",
  spf_neutral: "Kayıttaki ?all ifadesini -all (veya geçiş döneminde ~all) ile değiştirin.",
  dmarc_monitor_only: 'Raporlar temiz görünüyorsa politikayı yükseltin:  v=DMARC1; p=quarantine; rua=mailto:dmarc@<alan>',
  dmarc_partial: 'pct değerini 100 yapın ya da pct etiketini kaldırın.',
  dmarc_no_policy: 'Kayda politika ekleyin:  v=DMARC1; p=quarantine; rua=mailto:dmarc@<alan>',
  dmarc_multiple: '_dmarc altında TEK bir v=DMARC1 kaydı bırakın.'
};

function emailCheck(id, karar, kayitlar, sorgu) {
  const m = CHECKS.tr[id];
  let status; let note = null;
  if (karar.durum === 'none') {
    if (sorgu && sorgu.kesin === false) { status = 'skipped'; note = 'not_measured'; }
    else { status = 'fail'; note = id + '_missing'; }
  } else {
    status = karar.durum;
    note = karar.not || null;
  }
  return {
    id: id, name: m[0], status: status, note: note,
    problem: note ? NOT_METNI[note] : null,
    detail: karar.detay || null,
    /* Ham kayıt gösteriliyor: müşteri neyin yayında olduğunu görsün. */
    records: kayitlar,
    risk: status === 'fail' ? m[1] : null,
    fix: status === 'fail' ? (NOT_DUZELTME[note] || m[2]) : null,
    fixPrice: status === 'fail' ? fixpricing.TIERS[fixpricing.tierOf(id)] : null
  };
}

/** spfDmarcKayitlari çıktısından araç sonucunu üretir. Saf: ağ yok. */
function emailReport(k) {
  const spfKayit = (k.spf || []).filter(function (r) { return /^v=spf1(\s|$)/i.test(r); });
  const checks = [
    emailCheck('spf', mail.spfDegerlendir(k.spf), spfKayit, k.spfSorgu),
    emailCheck('dmarc', mail.dmarcDegerlendir(k.dmarc), k.dmarc || [], k.dmarcSorgu)
  ];
  return {
    type: 'email',
    host: k.alan,
    dmarcName: k.dmarcAd || null,
    summary: {
      total: checks.length,
      pass: checks.filter(function (c) { return c.status === 'pass'; }).length,
      fail: checks.filter(function (c) { return c.status === 'fail'; }).length
    },
    checks: checks,
    checkedAt: new Date().toISOString()
  };
}

async function emailRun(host, deps) {
  /* IP adresinin SPF/DMARC'ı olmaz; DNS'e hiç sorulmaz. */
  if (net.isIP(String(host).replace(/^\[|\]$/g, ''))) return { ok: false, code: 'bad_domain' };
  const oku = (deps && deps.mail) || mail.spfDmarcKayitlari;
  let k;
  try {
    k = await oku(host);
  } catch (err) {
    return { ok: false, code: 'dns_failed' };
  }
  if (!k || !k.ok) {
    const sebep = k && k.sebep;
    return { ok: false, code: sebep === 'domain_not_found' ? 'domain_not_found' : sebep === 'not_a_domain' ? 'bad_domain' : 'dns_failed' };
  }
  return Object.assign({ ok: true }, emailReport(k));
}

function errorCode(err) {
  const m = err && err.message;
  if (m === 'timeout' || m === 'blocked_target' || m === 'dns_failed') return m;
  return 'unreachable';
}

/**
 * @param {string} type  TYPES içinden
 * @param {string} rawUrl
 * @param {{fetch?: Function, mail?: Function}} [deps] sınama için guardedFetch /
 *   mail.spfDmarcKayitlari yerine geçer
 * @returns {Promise<{ok: true} & object | {ok: false, code: string}>}
 */
async function run(type, rawUrl, deps) {
  if (TYPES.indexOf(type) === -1) return { ok: false, code: 'invalid_type' };
  const target = normalizeTarget(rawUrl);
  if (target.error) return { ok: false, code: target.error };
  if (type === 'email') return emailRun(target.host, deps);
  const fetchFn = (deps && deps.fetch) || scanner.guardedFetch;
  let sonuc;
  try {
    sonuc = await fetchFn(target.url, {});
  } catch (err) {
    return { ok: false, code: errorCode(err) };
  }
  try { if (sonuc.response.body) await sonuc.response.body.cancel(); } catch (e) { /* yok say */ }
  return Object.assign({ ok: true },
    headersReport({ headers: sonuc.response.headers, finalUrl: sonuc.finalUrl, html: null }));
}

module.exports = { run, headersReport, emailReport, HEADER_IDS, EMAIL_IDS, TOP_N, TYPES };
