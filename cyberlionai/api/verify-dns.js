'use strict';

/**
 * POST /api/verify-dns  { domain }
 *
 * Panelin "alan adını doğrula" ekranının arka ucu. Bir alan adının SPF ve
 * DMARC kayıtlarını okur ve müşteriye tek cümlelik bir yanıt verecek kadar
 * sadeleştirir.
 *
 * SÖZLEŞME (dashboard.html içinde belgelenmişti; birebir uygulanıyor)
 *
 *   200 → { spf: { found, record }, dmarc: { found, policy, record } }
 *   202 → { jobId, statusUrl }   (bkz. "NEDEN 202 YOK")
 *   404 → uç yayında değil; sayfa dürüstçe "yayında değil" diyor
 *
 * NEDEN 202 YOK
 *
 * Sözleşme eşzamansız yola da izin veriyor ama bu uç 200 ile cevap veriyor:
 * ölçülen DNS gecikmesi 16–330 ms (mail.js'teki ölçüm notu) ve burada yalnızca
 * iki sorgu var. Bir iş kaydı açmak, kuyruk kurmak ve istemciyi 2 saniyede bir
 * yoklatmak bu süre için daha yavaş VE daha kırılgan olurdu. İstemci iki yolu
 * da desteklediği için 202'ye geçmek ileride uca özel bir değişiklikle
 * mümkün; sözleşme kapalı değil.
 *
 * Bu yüzden iş kimliği ÜRETİLMİYOR, dolayısıyla `GET ?id=` yoklaması da
 * karşılıksız: 404 döner. İstemci yoklamaya yalnızca 202'den sonra geçtiği
 * için bu yol hiç kullanılmıyor.
 *
 * NEDEN YENİ AYRIŞTIRICI YAZILMADI
 *
 * SPF/DMARC ayrıştırıcıları `_lib/mail.js`'te zaten var, gerçek alan adları
 * üzerinde ölçülerek kalibre edilmiş ve `tools/mail-test.js` ile CI'da
 * tutuluyor (255 baytlık TXT parçalarının birleştirilmesi, birden fazla
 * kaydın RFC'ye göre hata sayılması, DMARC'ın kuruluş alan adına güvenli
 * düşmesi). İkinci bir ayrıştırıcı, iki yerin aynı alan adı için farklı şey
 * söylemesi demekti.
 *
 * p=none KIRMIZI
 *
 * `p=none` yalnızca raporlama modudur: sahte e-posta yine teslim edilir.
 * Kayıt BULUNMUŞ sayılır (`found: true`) ama politika `none` döner ve ekran
 * bunu kırmızı gösterir. Ayrıca `status: 'fail'` ve `note: 'dmarc_monitor_only'`
 * dönüyor, yani karar sunucuda da açıkça veriliyor; ekranın yorumuna
 * bırakılmış bir ayrıntı değil.
 *
 * `found` ALANININ İKİ ALANDA FARKLI ANLAMI (bilinçli)
 *
 *   dmarc.found = kayıt VAR mı. Politikayı ekran kendisi yargılıyor
 *                 (`found && policy !== 'none'`), bu yüzden varlık yeterli.
 *   spf.found   = kayıt GERÇEKTEN KORUYOR mu. Ekranın SPF için ayrı bir
 *                 politika yargısı yok; `found: true` doğrudan yeşil rozet
 *                 demek. `v=spf1 ... +all` kaydı herkese gönderme yetkisi
 *                 verir, yani kaydın hiç olmamasından kötüdür — ona yeşil
 *                 göstermek müşteriye yanlış güven satmak olurdu. Bu yüzden
 *                 SPF'te `found`, ayrıştırıcının 'pass' kararına bağlı.
 *
 * Her iki alan `status` ve `note` da taşıyor (ek alanlar; istemci bilmediğini
 * yok sayıyor), böylece ekran ileride "kaydınız var ama +all" gibi bir cümle
 * kurabilir.
 *
 * HIZ SINIRI KAPALI DEVRE
 *
 * Bu uç, İSTEMCİNİN SEÇTİĞİ bir alan adına bizim altyapımızdan DNS sorgusu
 * attırıyor. Sınır olmadan birinin yetkili sunucusuna yük bindirmek için
 * kullanılabilir. Bu yüzden sayaç çalışmıyorsa istek REDDEDİLİYOR (503):
 * yoklama ucunun aksine burada "sınır uygulanamadı ama devam et" demek,
 * aracı biz olduğumuz hâlde zararı başkasına yazmak olurdu.
 */

const mail = require('./_lib/mail.js');
const store = require('./_lib/store.js');
const { clientIp, ipKey } = require('./_lib/session.js');

/* Tarama kovasından AYRI: bu uç tarama hakkı harcamıyor, sorgu da ucuz.
   Yine de bir istemcinin uca yüklenmesini engelleyecek kadar dar. */
const RATE_WINDOW_SECONDS = 10 * 60;
const RATE_MAX = 20;

/* Aynı alan adı kısa süre içinde tekrar sorulursa DNS'e gitmiyoruz. Kullanıcı
   kaydı düzeltip yeniden denediğinde beklemesin diye kısa tutuldu. */
const CACHE_TTL_SECONDS = 120;

const MAX_UZUNLUK = 253;
const ETIKET = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const ALAN_BICIMI = new RegExp('^' + ETIKET + '(?:\\.' + ETIKET + ')+$');

/* Genel DNS'te karşılığı olmayan son ekler. Buraya sorgu atmak çözücüyü iç
   ağa yöneltmek olurdu; "SPF yok" demek de yanlış olurdu çünkü soru anlamsız. */
const YEREL_SONEK = [
  'localhost', 'local', 'internal', 'intranet', 'lan', 'home', 'corp',
  'test', 'invalid', 'example', 'onion', 'localdomain'
];

/**
 * İstemciden gelen alan adını normalize eder ve kabul edilebilir mi, söyler.
 * @returns {{ok: true, alan: string} | {ok: false, kod: string}}
 */
function alanDogrula(ham) {
  if (typeof ham !== 'string') return { ok: false, kod: 'empty' };

  let alan = ham.trim().toLowerCase();
  if (!alan) return { ok: false, kod: 'empty' };

  /* Kullanıcı adres yapıştırmış olabilir: şema, yol, kullanıcı adı ve port
     atılıyor. Burada hata vermek yerine temizlemek doğru; ekranda da aynısı
     yapılıyor ve iki taraf aynı girdiyi aynı alan adına indirmeli. */
  alan = alan.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  alan = alan.split('/')[0].split('?')[0].split('#')[0];
  alan = alan.split('@').pop();
  alan = alan.split(':')[0];
  alan = alan.replace(/\.+$/, '');            // kök noktası
  alan = mail.alanAdi(alan);                  // "www." soyuluyor (aynı kural)

  if (!alan) return { ok: false, kod: 'empty' };
  if (alan.length > MAX_UZUNLUK) return { ok: false, kod: 'bad_domain' };
  if (alan.indexOf('.') === -1) return { ok: false, kod: 'bad_domain' };
  if (!ALAN_BICIMI.test(alan)) return { ok: false, kod: 'bad_domain' };

  const parca = alan.split('.');
  const son = parca[parca.length - 1];

  /* Tamamı rakamdan oluşan son etiket: IP adresi yazılmış. SPF/DMARC alan
     adına bağlı kayıtlar, IP'de karşılığı yok. */
  if (/^[0-9]+$/.test(son)) return { ok: false, kod: 'bad_domain' };
  if (YEREL_SONEK.indexOf(son) !== -1) return { ok: false, kod: 'bad_domain' };

  return { ok: true, alan: alan };
}

/**
 * İki sorgu da KESİN bir cevap verdi mi? `kesin: false`, kaydın yok olduğu
 * değil sorgunun tamamlanamadığı anlamına geliyor (bkz. mail.js'teki not).
 * Eski sürümleri de kaldırıyor: alan yoksa ölçülmüş sayılır.
 */
function olculdu(kayitlar) {
  const spf = kayitlar.spfSorgu;
  const dmarc = kayitlar.dmarcSorgu;
  return (!spf || spf.kesin !== false) && (!dmarc || dmarc.kesin !== false);
}

/** Ayrıştırıcı kararlarını sözleşmedeki biçime çevirir. */
function yanitGovdesi(kayitlar) {
  const spfKarar = mail.spfDegerlendir(kayitlar.spf);
  const dmarcKarar = mail.dmarcDegerlendir(kayitlar.dmarc);

  const spfKaydi = (kayitlar.spf || []).filter(function (k) {
    return /^v=spf1(\s|$)/i.test(k);
  })[0] || null;
  const dmarcKaydi = (kayitlar.dmarc || [])[0] || null;

  /* Politika HAM kayıttan okunuyor, ayrıştırıcının özet metninden değil:
     'p=none' durumunda detay zaten 'p=none', ama pct<100 durumunda detay
     'p=reject; pct=50' oluyor ve oradan politika sökmek kırılgan olurdu. */
  const p = dmarcKaydi
    ? /(?:^|;)\s*p\s*=\s*(none|quarantine|reject)/i.exec(dmarcKaydi) : null;

  return {
    domain: kayitlar.alan,
    spf: {
      /* Yalnızca GERÇEKTEN koruyan kayıt yeşil — yukarıdaki nota bakın. */
      found: spfKarar.durum === 'pass',
      record: spfKaydi,
      status: spfKarar.durum,
      note: spfKarar.not || null
    },
    dmarc: {
      found: dmarcKaydi !== null,
      policy: p ? p[1].toLowerCase() : null,
      record: dmarcKaydi,
      status: dmarcKarar.durum,
      note: dmarcKarar.not || null,
      /* Kayıt üst alan adından geldiyse hangi isimde bulunduğu söyleniyor;
         kullanıcı kaydı kendi alanında arayıp bulamazsa kafası karışmasın. */
      recordName: kayitlar.dmarcAd || null
    },
    checkedAt: new Date().toISOString()
  };
}

/** Gövde string gelebilir (içerik türü ayarlanmamışsa Vercel ayrıştırmaz). */
function govdeAl(req) {
  const b = req && req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string' && b) {
    try { return JSON.parse(b); } catch (err) { return null; }
  }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  /* Yoklama yolu yok: iş kimliği üretmiyoruz (bkz. "NEDEN 202 YOK"). */
  if (req.method === 'GET') {
    return res.status(404).json({ error: { code: 'no_async_job' } });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  const govde = govdeAl(req);
  const dogrulama = alanDogrula(govde && govde.domain);
  if (!dogrulama.ok) {
    return res.status(400).json({ error: { code: dogrulama.kod } });
  }
  const alan = dogrulama.alan;

  /* Sayaç yoksa uç kapalı — kapalı devre, yukarıdaki nota bakın. */
  if (!store.isConfigured()) {
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }
  try {
    const rate = await store.hitRateLimit(
      'cl:rl:dns:' + ipKey(clientIp(req)), RATE_WINDOW_SECONDS);
    if (rate.count > RATE_MAX) {
      const retryAfter = rate.ttl > 0 ? rate.ttl : RATE_WINDOW_SECONDS;
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: { code: 'rate_limited', retryAfter: retryAfter } });
    }
  } catch (err) {
    return res.status(503).json({ error: { code: 'service_unavailable' } });
  }

  const onbellekAnahtari = 'cl:dns:' + alan;
  try {
    const hazir = await store.cacheGet(onbellekAnahtari);
    if (hazir) return res.status(200).json(hazir);
  } catch (err) {
    /* Önbellek okunamadı: taze sorgu atılıyor, istek düşmüyor. */
  }

  /* Sorgu tamamlanamazsa BİR kez daha denenir. Çözücü `tries: 1` ile kurulu
     (tarama süresini uzatmamak için) ve büyük TXT yanıtları zaman aşımına
     uğrayabiliyor: bu ortamda google.com'un TXT sorgusu tam olarak böyle
     düştü. Tek tekrar, çoğu geçici düşmeyi kapatıyor. */
  let kayitlar;
  try {
    kayitlar = await mail.spfDmarcKayitlari(alan);
    if (kayitlar.ok && !olculdu(kayitlar)) {
      kayitlar = await mail.spfDmarcKayitlari(alan);
    }
  } catch (err) {
    return res.status(502).json({ error: { code: 'dns_failed' } });
  }

  if (!kayitlar.ok) {
    /* Alan adı çözülmüyor. 404 DEĞİL: ekran POST'a gelen 404'ü "uç yayında
       değil" diye okuyor ve kullanıcıya yanlış cümle kurardı. */
    const kod = kayitlar.sebep === 'domain_not_found' ? 'domain_not_found' : 'bad_domain';
    return res.status(422).json({ error: { code: kod } });
  }

  /* ÖLÇÜLEMEDİYSE CEVAP VERİLMİYOR. Ekranın tek gösterebildiği şey "var" ya
     da "yok"; ölçülemeyen bir sorguyu "yok" diye vermek, kaydı doğru olan
     müşteriye alan adının korunmasız olduğunu söylemek olurdu. Hata dönüp
     kullanıcıyı tekrar denemeye bırakmak, yanlış cevap vermekten iyidir. */
  if (!olculdu(kayitlar)) {
    const dusen = !(kayitlar.spfSorgu || {}).kesin ? 'spf' : 'dmarc';
    return res.status(502).json({ error: { code: 'dns_failed', record: dusen } });
  }

  const govdeYanit = yanitGovdesi(kayitlar);

  try {
    await store.cacheSet(onbellekAnahtari, govdeYanit, CACHE_TTL_SECONDS);
  } catch (err) {
    /* Önbelleğe yazılamadı: sonucu vermeye engel değil. */
  }

  return res.status(200).json(govdeYanit);
};
