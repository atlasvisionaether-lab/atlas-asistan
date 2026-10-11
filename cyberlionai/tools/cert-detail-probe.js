'use strict';

/**
 * Sertifika detayı ölçümü: OCSP stapling, zincir eksiksizliği, anahtar gücü.
 *
 *   node cyberlionai/tools/cert-detail-probe.js [alanadi ...]
 *
 * NEDEN VAR
 *
 * Motorda `tls_cert` zaten son kullanma tarihini ölçüyor (scanner.js
 * inspectTls → daysLeft). Eklenmesi düşünülen üç şey için ise ÖNCE şu
 * soruların cevaplanması gerekiyor — hiçbiri varsayılamaz:
 *
 *   1. OCSP STAPLING ÖLÇÜLEBİLİYOR MU? Node'da `requestOCSP: true` ile
 *      'OCSPResponse' olayı var, ama olay GELMEZSE bunun iki ayrı anlamı
 *      olabilir: (a) sunucu stapling yapmıyor, (b) biz isteği yanlış
 *      kurduk. İkisini ayırmak için stapling yaptığı BİLİNEN bir sunucuyla
 *      karşılaştırma şart.
 *
 *   2. OCSP BUGÜN BİR ÖLÇÜT MÜ? Let's Encrypt 2025'te OCSP yanıtlarını
 *      kullanımdan kaldırdı. Eğer LE sertifikalarında stapling artık hiç
 *      gelmiyorsa, "stapling yok → başarısız" diyen bir kontrol kendi
 *      sitemiz dahil herkesi haksız yere cezalandırırdı. Bu yüzden ölçüm,
 *      kontrolün YAZILIP YAZILMAYACAĞINA karar verecek.
 *
 *   3. ZİNCİR EKSİKLİĞİ GÖRÜLEBİLİYOR MU? Node `getPeerCertificate(true)`
 *      ile zinciri `issuerCertificate` üzerinden veriyor, ama bu zincirin
 *      SUNUCUNUN GÖNDERDİĞİ mi yoksa yerel kök deposundan tamamlanmış mı
 *      olduğu belgede net değil. Eksik zincirli bir sunucuda ne döndüğü
 *      ölçülmeli; yoksa "eksiksiz" diyen bir kontrol yalan söyler.
 *
 * Varsayılan listede badssl.com alt alan adları var: bunlar tam olarak bu
 * ölçüm için kurulmuş, kamuya açık test sunucuları ve negatif referans
 * olmadan "eksik zincir" iddiası doğrulanamaz. Üçüncü taraf alan adlarının
 * OTOMATİK ya da PERİYODİK taranması bu projede ayrı onay gerektirir; bu
 * betik elle, bir kez koşar ve hiçbir iş akışına zamanlanmaz.
 *
 * Salt-okunur: yalnızca TLS el sıkışması yapar, HTTP isteği göndermez.
 */

const tls = require('tls');

const KALIN = '\x1b[1m';
const SIFIRLA = '\x1b[0m';

const ZAMAN_ASIMI = 8000;

function yaz(etiket, deger) {
  process.stdout.write('   ' + String(etiket).padEnd(24) + String(deger) + '\n');
}

/**
 * Zinciri yürür. Dönen dizi SUNUCUDAN gelen sırayla: yaprak, ara, (varsa) kök.
 * Node kökü kendisine işaret eden bir `issuerCertificate` ile kapatır; döngüye
 * girmemek için fingerprint karşılaştırıyoruz.
 */
function zincir(cert) {
  const liste = [];
  let c = cert;
  const gorulen = new Set();
  while (c && c.fingerprint256 && !gorulen.has(c.fingerprint256)) {
    gorulen.add(c.fingerprint256);
    liste.push({
      subject: (c.subject && (c.subject.CN || c.subject.O)) || null,
      issuer: (c.issuer && (c.issuer.CN || c.issuer.O)) || null,
      ca: !!c.ca,
      bits: c.bits || null,
      curve: c.asn1Curve || c.nistCurve || null,
      kendinden: !!(c.subject && c.issuer && c.subject.CN && c.subject.CN === c.issuer.CN)
    });
    c = c.issuerCertificate;
  }
  return liste;
}

function olc(host) {
  return new Promise(function (coz) {
    let ocsp = false;
    let ocspBoyut = null;

    let socket;
    try {
      socket = tls.connect({
        host: host,
        port: 443,
        servername: host,
        /* Hatalı sertifikada da bilgi toplayabilmek için motorun yaptığının
           aynısı (scanner.js inspectTls). Doğrulama sonucunu ayrıca okuyoruz. */
        rejectUnauthorized: false,
        requestOCSP: true,
        ALPNProtocols: ['http/1.1']
      });
    } catch (e) {
      return coz({ ok: false, hata: (e && e.code) || 'connect_error' });
    }

    const bitir = function (sonuc) {
      try { socket.destroy(); } catch (e) { /* yok say */ }
      coz(sonuc);
    };

    socket.setTimeout(ZAMAN_ASIMI, function () { bitir({ ok: false, hata: 'timeout' }); });
    socket.on('error', function (e) { bitir({ ok: false, hata: (e && e.code) || 'error' }); });

    /* Bu olay stapling'in TEK kanıtı. Gelmezse "yok" demek için önce
       geldiği bir sunucu görmek gerekiyor — listedeki karşılaştırma bu. */
    socket.on('OCSPResponse', function (yanit) {
      ocsp = true;
      ocspBoyut = yanit ? yanit.length : 0;
    });

    socket.on('secureConnect', function () {
      const yaprak = socket.getPeerCertificate(true);
      const son = yaprak && yaprak.valid_to ? new Date(yaprak.valid_to) : null;
      bitir({
        ok: true,
        protocol: socket.getProtocol(),
        authorized: socket.authorized,
        authorizationError: socket.authorizationError ? String(socket.authorizationError) : null,
        ocsp: ocsp,
        ocspBoyut: ocspBoyut,
        validTo: son && !isNaN(son) ? son.toISOString() : null,
        gunKaldi: son && !isNaN(son) ? Math.floor((son - Date.now()) / 86400000) : null,
        sigalg: yaprak ? (yaprak.sigalg || null) : null,
        zincir: zincir(yaprak)
      });
    });
  });
}

(async function () {
  const liste = process.argv.slice(2).length ? process.argv.slice(2) : [
    'cyberlionai.com',              // kendi sitemiz (Let's Encrypt, ölçüldü: koşu 38162493841)
    'www.cyberlionai.com',
    'atlasasistan.com',             // kendi sitemiz
    'google.com',                   // Google Trust Services — stapling karşılaştırması
    'digicert.com',                 // stapling yaptığı bilinen ticari makam
    'incomplete-chain.badssl.com',  // NEGATİF referans: ara sertifika gönderilmiyor
    'expired.badssl.com'            // NEGATİF referans: süresi geçmiş
  ];

  process.stdout.write(KALIN + 'Sertifika detayı ölçümü' + SIFIRLA + '\n');
  process.stdout.write('Node   : ' + process.version + '\n');
  process.stdout.write('OpenSSL: ' + process.versions.openssl + '\n');

  for (const host of liste) {
    process.stdout.write('\n' + KALIN + '== ' + host + SIFIRLA + '\n');
    const s = await olc(host);

    if (!s.ok) { yaz('ÖLÇÜLEMEDİ', s.hata); continue; }

    yaz('protokol', s.protocol);
    yaz('doğrulandı', s.authorized + (s.authorizationError ? '  (' + s.authorizationError + ')' : ''));
    yaz('OCSP stapling', s.ocsp ? 'VAR (' + s.ocspBoyut + ' bayt)' : 'YOK');
    yaz('son kullanma', s.validTo + '  (' + s.gunKaldi + ' gün)');
    yaz('imza algoritması', s.sigalg || '(Node vermiyor)');
    yaz('zincir uzunluğu', s.zincir.length);
    s.zincir.forEach(function (c, i) {
      yaz('  [' + i + ']', (c.subject || '?') + '  ← ' + (c.issuer || '?') +
        '  ca=' + c.ca + '  bits=' + c.bits + (c.curve ? '  curve=' + c.curve : '') +
        (c.kendinden ? '  (kendinden imzalı)' : ''));
    });
  }

  process.stdout.write('\n' + KALIN + 'Okunacak sorular' + SIFIRLA + '\n');
  process.stdout.write('1. Hiçbir sunucuda stapling "VAR" çıkmadıysa ölçüm bozuk; kontrol YAZILMAZ.\n');
  process.stdout.write('2. Yalnızca Let\'s Encrypt\'te "YOK" ise bu LE kararı, sitenin kusuru değil.\n');
  process.stdout.write('3. incomplete-chain zincir uzunluğu diğerlerinden KISA mı? Değilse Node\n');
  process.stdout.write('   zinciri yerel depodan tamamlıyor ve eksiklik bu yolla ÖLÇÜLEMEZ.\n');
})();
