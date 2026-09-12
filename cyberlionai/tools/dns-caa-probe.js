'use strict';

/**
 * CAA ve DNSSEC ölçümü.
 *
 *   node cyberlionai/tools/dns-caa-probe.js [alanadi ...]
 *
 * NEDEN VAR
 *
 * İki soru, ikisi de kontrolü yazmadan önce cevaplanmalı:
 *
 *   1. CAA — Node'un `resolveCaa`'sı var, ama kaydı NE DÖNDÜRÜYOR? Nesne
 *      biçimi ({ issue: '...' } mi, { critical, issue } mi), birden fazla
 *      kayıt nasıl geliyor, kaydı olmayan alan adı hangi hatayı veriyor?
 *
 *   2. DNSSEC — Node'un dns modülünde DS ya da DNSKEY sorgusu YOK
 *      (resolveCaa, resolveTlsa var; DS yok). Yani DNSSEC'i ölçmek için ham
 *      DNS paketi göndermek gerekiyor. Asıl soru şu: bu ortamda UDP/53
 *      çalışıyor mu? Çalışmıyorsa kontrol yazılmamalı ya da dürüstçe
 *      "ölçülemedi" demeli — UDP'nin çalıştığını VARSAYIP kontrol yazmak,
 *      üretimde sessizce "DNSSEC yok" diyen bir rapor üretirdi.
 *
 * Salt-okunur.
 */

const dns = require('dns');
const dgram = require('dgram');

const KALIN = '\x1b[1m';
const SIFIRLA = '\x1b[0m';

const SUNUCU = process.env.RESOLVER || '1.1.1.1';
const cozucu = new dns.promises.Resolver({ timeout: 5000, tries: 2 });
cozucu.setServers([SUNUCU]);

function yaz(etiket, deger) {
  process.stdout.write('   ' + String(etiket).padEnd(20) + String(deger) + '\n');
}

/* ---------------------------------------------------------------------------
   Ham DNS sorgusu. Yalnızca SORU gönderip YANIT BAŞLIĞINI okuyoruz; tam bir
   çözümleyici yazmıyoruz. İhtiyacımız olan üç şey var:
     - yanıt geldi mi (UDP/53 açık mı?)
     - ANCOUNT > 0 mu (sorulan tür için kayıt var mı?)
     - AD biti set mi (yanıt DNSSEC ile DOĞRULANMIŞ mı?)
   AD biti asıl cevabı veriyor: DS kaydının VARLIĞI zincirin çalıştığını
   göstermez, çözücünün doğrulamış olması gösterir.
--------------------------------------------------------------------------- */

const TIP = { DS: 43, DNSKEY: 48, A: 1 };

function soruPaketi(ad, tip) {
  const etiketler = ad.split('.').filter(Boolean);
  let n = 12;
  etiketler.forEach(function (e) { n += 1 + Buffer.byteLength(e); });
  n += 1 + 4 + 11;                      // kök + QTYPE/QCLASS + EDNS0 OPT

  const b = Buffer.alloc(n);
  b.writeUInt16BE(Math.floor(Math.random() * 65535), 0);  // kimlik
  /* 0x0120: RD (özyineleme istenir) + AD (doğrulanmış veri isteriz).
     AD'yi SORUDA set etmek, çözücüden doğrulama yapmasını istemenin yoludur. */
  b.writeUInt16BE(0x0120, 2);
  b.writeUInt16BE(1, 4);                // QDCOUNT
  b.writeUInt16BE(0, 6);
  b.writeUInt16BE(0, 8);
  b.writeUInt16BE(1, 10);               // ARCOUNT = 1 (OPT)

  let o = 12;
  etiketler.forEach(function (e) {
    b.writeUInt8(Buffer.byteLength(e), o); o += 1;
    o += b.write(e, o);
  });
  b.writeUInt8(0, o); o += 1;
  b.writeUInt16BE(tip, o); o += 2;      // QTYPE
  b.writeUInt16BE(1, o); o += 2;        // QCLASS = IN

  /* EDNS0 OPT kaydı, DO biti set: DNSSEC imzalarını istiyoruz. Bu olmadan
     çözücü doğrulama yapmayabilir ve AD biti hiç gelmez. */
  b.writeUInt8(0, o); o += 1;           // kök ad
  b.writeUInt16BE(41, o); o += 2;       // TYPE = OPT
  b.writeUInt16BE(4096, o); o += 2;     // UDP yük boyutu
  b.writeUInt8(0, o); o += 1;           // genişletilmiş RCODE
  b.writeUInt8(0, o); o += 1;           // sürüm
  b.writeUInt16BE(0x8000, o); o += 2;   // DO biti
  b.writeUInt16BE(0, o);                // RDLENGTH
  return b;
}

function hamSorgu(ad, tip) {
  return new Promise(function (coz) {
    const s = dgram.createSocket('udp4');
    const zamanlayici = setTimeout(function () {
      try { s.close(); } catch (e) { /* kapanmışsa sorun değil */ }
      coz({ ok: false, sebep: 'timeout' });
    }, 5000);

    s.on('error', function (e) {
      clearTimeout(zamanlayici);
      try { s.close(); } catch (x) { /* yoksay */ }
      coz({ ok: false, sebep: e.code || 'error' });
    });

    s.on('message', function (m) {
      clearTimeout(zamanlayici);
      try { s.close(); } catch (x) { /* yoksay */ }
      const bayraklar = m.readUInt16BE(2);
      coz({
        ok: true,
        rcode: bayraklar & 0x0f,
        ad: !!(bayraklar & 0x0020),       // AD: doğrulanmış veri
        cd: !!(bayraklar & 0x0010),
        cevap: m.readUInt16BE(6)          // ANCOUNT
      });
    });

    s.send(soruPaketi(ad, tip), 53, SUNUCU, function (e) {
      if (e) {
        clearTimeout(zamanlayici);
        try { s.close(); } catch (x) { /* yoksay */ }
        coz({ ok: false, sebep: e.code || 'send_error' });
      }
    });
  });
}

async function olc(alan) {
  process.stdout.write('\n' + KALIN + '== ' + alan + SIFIRLA + '\n');

  /* --- CAA --- */
  try {
    const caa = await cozucu.resolveCaa(alan);
    yaz('CAA', caa.length + ' kayıt');
    caa.forEach(function (k) { yaz('  ', JSON.stringify(k)); });
  } catch (e) {
    yaz('CAA', e.code + '  (kayıt yok ya da alan adı yok)');
  }

  /* CAA üst alan adına DÜŞER (RFC 8659): sertifika makamı, ad bulunamazsa
     ebeveyne bakar. Alt alan adında kayıt olmaması eksiklik DEĞİL. */
  const parca = alan.split('.');
  if (parca.length > 2) {
    try {
      const ust = await cozucu.resolveCaa(parca.slice(1).join('.'));
      yaz('  üst alan CAA', ust.length + ' kayıt');
    } catch (e) {
      yaz('  üst alan CAA', e.code);
    }
  }

  /* --- DNSSEC --- */
  const ds = await hamSorgu(alan, TIP.DS);
  yaz('DS sorgusu', ds.ok
    ? 'rcode=' + ds.rcode + '  cevap=' + ds.cevap + '  AD=' + ds.ad
    : 'BAŞARISIZ (' + ds.sebep + ')');

  const a = await hamSorgu(alan, TIP.A);
  yaz('A sorgusu (AD?)', a.ok
    ? 'rcode=' + a.rcode + '  cevap=' + a.cevap + '  AD=' + a.ad
    : 'BAŞARISIZ (' + a.sebep + ')');
}

(async function () {
  const liste = process.argv.slice(2).length ? process.argv.slice(2) : [
    'cyberlionai.com',
    'atlasasistan.com',
    'cloudflare.com',      // DNSSEC açık olduğu bilinen
    'ietf.org',            // DNSSEC açık
    'google.com',          // DNSSEC KAPALI — negatif referans
    'nic.tr',
    'trendyol.com'
  ];

  process.stdout.write(KALIN + 'CAA ve DNSSEC ölçümü' + SIFIRLA + '\n');
  process.stdout.write('Çözücü: ' + SUNUCU + '\n');
  process.stdout.write('Node  : ' + process.version + '\n');

  /* ÖNCE bu: UDP/53 bu ortamda hiç çalışıyor mu? Çalışmıyorsa aşağıdaki
     bütün DNSSEC satırları "BAŞARISIZ" olur ve bu bir ölçüm sonucudur —
     kontrolün yazılıp yazılmayacağına o karar verir. */
  const deneme = await hamSorgu('cloudflare.com', TIP.A);
  process.stdout.write('UDP/53: ' + (deneme.ok ? 'ÇALIŞIYOR' : 'ÇALIŞMIYOR (' + deneme.sebep + ')') + '\n');

  const t0 = Date.now();
  for (const a of liste) {
    try { await olc(a); } catch (e) { process.stdout.write('   HATA ' + e.message + '\n'); }
  }
  process.stdout.write('\n' + KALIN + 'Toplam' + SIFIRLA + ': ' + (Date.now() - t0) + 'ms / ' +
    liste.length + ' alan adı\n');
})();
