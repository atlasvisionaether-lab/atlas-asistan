/* Cyber Lion AI — müşteri paneli (/dashboard).
 *
 * VERİ KAYNAKLARI (hepsi sunucudan, tarayıcıda anahtar yok; oturum HttpOnly çerezde):
 *   GET  /api/auth/me              → e-posta + kota
 *   GET  /api/panel/subscription   → plan, KDV hariç ücret, abonelikler
 *   GET  /api/panel/scans          → liste + skor eğilimi; ?id= → OWASP gruplu bulgular
 *   GET  /api/report?jobId=        → PDF
 *   POST /api/auth/password        → şifre değiştirme
 *   POST /api/auth/magiclink, /api/auth/logout
 *   POST /api/verify-dns, /api/autofix-cloudflare (Araçlar)
 *
 * ARKA UCU OLMAYAN ALANLAR (faturalar, VKN, self-servis iptal, oturum listesi,
 * 2FA, API token, bildirim tercihleri) HTML'de "Yakında" olarak duruyor.
 * Canlıda sahte veri gösterilmez; örnek veri yalnızca ?demo=1 ile ve ekranda
 * "ÖRNEK VERİ" şeridiyle açılır.
 *
 * Harici dosya olmasının sebebi CSP: script-src 'self' + hash. Satır içi
 * script her değiştiğinde hash yenilemek gerekmesin.
 *
 * Taranan siteden gelen her metin (alan adı, bulgu başlığı, kanıt) textContent
 * ile yazılır; innerHTML kullanılmaz.
 */
(function () {
  'use strict';

  /* ================= i18n ================= */
  var DICT = {
    tr: {
      'nav.home': 'Ana Sayfa', 'nav.sections': 'Panel bölümleri',
      'nav.overview': 'Genel Bakış', 'nav.scans': 'Taramalar', 'nav.billing': 'Abonelik',
      'nav.security': 'Güvenlik', 'nav.notifications': 'Bildirimler', 'nav.tools': 'Araçlar', 'nav.support': 'Destek',
      'demo.banner': 'ÖRNEK VERİ — Bu görünüm ?demo=1 ile açıldı; hiçbir değer gerçek bir hesaba ait değildir.',
      'gate.loading': 'Panel yükleniyor…', 'gate.title': 'Panelinize giriş yapın',
      'gate.desc': 'E-posta adresinizi yazın, tek kullanımlık bir giriş bağlantısı gönderelim. Şifreyle giriş için ana sayfadaki "Giriş Yap" düğmesini kullanabilirsiniz.',
      'gate.email': 'E-posta', 'gate.send': 'Giriş bağlantısı gönder', 'gate.password': 'Şifreyle giriş',
      'gate.downTitle': 'Panel şu an kullanılamıyor',
      'gate.down': 'Hesap hizmetine şu an ulaşılamıyor. Tarama geçmişiniz kaybolmadı; lütfen birazdan tekrar deneyin.',
      'profile.quota': 'Kalan tarama hakkı', 'profile.upgrade': "PRO'ya Geç", 'profile.manage': 'Planı Yönet', 'profile.logout': 'Çıkış',
      'overview.title': 'Genel Bakış', 'overview.score': 'Güvenlik Skoru', 'overview.scoreSub': 'Son tamamlanan tarama',
      'overview.total': 'Toplam Tarama', 'overview.month': 'Bu ay', 'overview.critical': 'Kritik Açık',
      'overview.criticalSub': 'Son taramadaki kritik bulgular', 'overview.last': 'Son Tarama', 'overview.quick': 'Hızlı Tara',
      'overview.trend': 'Skor Eğilimi',
      'scans.title': 'Son Taramalar', 'scans.filter': 'Durum süzgeci', 'scans.all': 'Tümü', 'scans.completed': 'Tamamlandı',
      'scans.failed': 'Başarısız', 'scans.search': 'Alan adında ara', 'scans.date': 'Tarih', 'scans.domain': 'Domain',
      'scans.score': 'Skor', 'scans.owasp': 'OWASP Açıklar', 'scans.status': 'Durum', 'scans.pdf': 'PDF', 'scans.detail': 'Detay',
      'scans.more': 'Daha fazla',
      'billing.title': 'Abonelik ve Faturalandırma', 'billing.current': 'Mevcut Plan', 'billing.plan': 'Plan',
      'billing.price': 'Ücret', 'billing.renewal': 'Yenileme', 'billing.change': 'Planı Yükselt',
      'billing.cancel': 'Düşür / İptal Talebi', 'billing.invoices': 'Faturalar ve Şirket Bilgileri',
      'billing.invoiceList': 'Fatura listesi (PDF)', 'billing.company': 'Şirket adı ve VKN düzenleme',
      'billing.selfServe': 'Plan düşürme / iptal (iyzico)',
      'billing.soonNote': 'Bu işlemler şimdilik destek ekibimiz tarafından yapılıyor. Fatura, şirket bilgisi veya iptal talebiniz için destek@cyberlionai.com adresine yazın; iptal, mesafeli satış sözleşmesindeki koşullarla işlenir.',
      'common.soon': 'Yakında',
      'security.title': 'Güvenlik Ayarları', 'security.password': 'Şifreyi Değiştir', 'security.new': 'Yeni şifre',
      'security.repeat': 'Yeni şifre (tekrar)', 'security.save': 'Şifreyi Güncelle',
      'security.pwNote': 'En az 10 karakter. Giriş bağlantısıyla girdiyseniz buradan ilk şifrenizi de belirleyebilirsiniz.',
      'security.access': 'Erişim', 'security.thisDevice': 'Bu cihaz', 'security.active': 'Aktif',
      'security.sessions': 'Diğer oturumlar', 'security.twofa': 'İki adımlı doğrulama (2FA)', 'security.apiToken': 'API token (Enterprise)',
      'security.cfNote': "Cloudflare 1-Tık Düzeltme bugün de kullanılabilir: Araçlar bölümünde kendi Cloudflare token'ınızla çalışır, token bizde saklanmaz.",
      'notif.title': 'Bildirimler', 'notif.weekly': 'Günlük izleme ve uyarılar', 'notif.email': 'E-posta bildirim tercihleri',
      'mon.domain': 'İzlenecek alan adı', 'mon.save': 'Kaydet',
      'alerts.title': 'İzleme uyarıları', 'alerts.markRead': 'Tümünü okundu işaretle',
      'tools.title': 'Araçlar', 'tools.dnsTitle': 'SPF ve DMARC Doğrulama',
      'badge.title': 'Canlı Güven Rozeti',
      'badge.desc': "Doğrulanmış alan adınızın son tarama skorunu ve tarihini gösteren rozet. Skor 80'in altındaysa gri görünür. Pro ve Enterprise planlarına dahildir.",
      'tools.dnsDesc': 'Alan adınızın e-posta sahteciliğine karşı SPF ve DMARC kayıtlarını kontrol edin. Sorgu sunucu tarafında gerçek DNS üzerinden yapılır.',
      'tools.domain': 'Alan adı', 'tools.check': 'Kontrol Et',
      'tools.spfHow': 'TXT kaydı olarak kök alan adına şu biçimde ekleyin (örnek):',
      'tools.dmarcHow': '_dmarc alt alan adına TXT kaydı ekleyin (örnek):',
      'tools.cfTitle': 'Cloudflare ile 1-Tık Düzeltme', 'tools.cfToken': "Cloudflare API token'ınız", 'tools.cfFix': 'Düzeltme türü',
      'tools.cfAll': 'Tümü (HSTS + CSP + X-Frame)', 'tools.cfApply': '1 Tıkla Uygula',
      'tools.cfWarn': "Token'ınız bizde saklanmaz; yalnızca bu istek için kullanılır. Geri almak için Cloudflare Dashboard > Rules > Transform Rules'dan CyberLion kuralını silin. CSP seçeneği sitenizin dış kaynaklarını (yazı tipi, analitik vb.) engelleyebilir; önce test ortamında deneyin.",
      'support.title': 'Destek', 'support.mail': 'E-posta ile destek', 'support.assistant': 'Canlı Asistan',
      'support.assistantSub': 'Ana sayfada sağ alt köşede; sık sorulan sorular dahil',
      'support.contact': 'İletişim formu', 'support.contactSub': 'Hafta içi 09:00–18:00 (TSİ)',
      'footer.copy': '© 2026 Ali Kotan - Şahıs İşletmesi', 'footer.legal': 'Yasal',
      'footer.kvkk': 'KVKK Aydınlatma Metni', 'footer.privacy': 'Gizlilik Politikası', 'footer.distance': 'Mesafeli Satış',
      'footer.refund': 'Teslimat ve İade', 'footer.terms': 'Kullanım Şartları',
      /* JS'in ürettiği metinler */
      title: 'Panelim',
      quotaMonth: 'Bu ay kalan tarama', quotaUnlimited: 'Sınırsız',
      sending: 'Gönderiliyor…', sent: 'Giriş bağlantısı gönderildi. E-postanızı kontrol edin.',
      badEmail: 'Geçerli bir e-posta adresi girin.', tooMany: 'Çok fazla deneme. Bir süre sonra tekrar deneyin.',
      failed: 'İşlem tamamlanamadı. Birazdan tekrar deneyin.', loading: 'Yükleniyor…',
      empty: 'Henüz taramanız yok. Ana sayfadan ilk taramanızı başlatın.', emptyFiltered: 'Bu süzgeçle eşleşen tarama yok.',
      scansDown: 'Tarama geçmişi şu an okunamıyor; kayıtlarınız kaybolmadı.',
      lockFree: function (n) { return n + ' tarama daha var. Tüm geçmiş için PRO\'ya geçin.'; },
      pdf: 'İndir', detail: 'Göster', hide: 'Gizle', noFindings: 'Bu taramada kayıtlı bulgu yok.',
      evidence: 'Kanıt', other: 'Kategorilendirilmemiş', scoreless: 'skor yok',
      findings: function (n, g) { return n + ' bulgu · ' + g + ' kategori'; },
      state: { completed: 'tamamlandı', failed: 'başarısız', pending: 'bekliyor', running: 'çalışıyor' },
      sev: { critical: 'kritik', high: 'yüksek', medium: 'orta', low: 'düşük', info: 'bilgi' },
      highToo: function (n) { return '+' + n + ' yüksek önem dereceli'; },
      noScore: 'Henüz skorlu tarama yok',
      trendNote: function (n) { return n + ' taramanın skoru, eskiden yeniye.'; },
      trendThin: 'Eğilim için en az iki skorlu tarama gerekiyor.',
      vsPrev: function (d) { return 'önceki taramaya göre ' + (d > 0 ? '+' : '') + d; },
      plans: { free: 'Free', pro: 'Pro', enterprise: 'Enterprise', unknown: 'Okunamadı' },
      perMonth: '/ay', vatEx: 'KDV hariç', freeForever: 'Süresiz ücretsiz',
      monthly: function (d) { return 'Aylık · başlangıç ' + d; },
      planUnknown: 'Plan bilgisi şu an okunamıyor. Ödeme yaptıysanız aboneliğiniz etkilenmez.',
      testMode: 'Test modu', toEnterprise: "Enterprise'a Geç",
      billNoteFree: 'Ücretsiz plandasınız. PRO ile ayda 50 tarama, OWASP gruplu PDF rapor ve skor eğilimi açılır.',
      billNotePaid: 'Fatura ve iptal talepleriniz şimdilik destek@cyberlionai.com üzerinden işleniyor.',
      weeklyOn: 'Planınıza dahil: {domain} her gün pasif olarak taranır. Skor düşüşü, SSL ve alan adı bitişi ile kara liste uyarıları aşağıda listelenir.',
      weeklyOnUptime: ' Enterprise: site erişilebilirliği 5 dakikada bir yoklanır.',
      weeklyNoDomain: 'Planınıza dahil. İzlenecek alan adını aşağıya yazın; alan adı hesabınızda doğrulanmış olmalı.',
      weeklyOff: 'Pro ve Enterprise planlarında alan adınız her gün taranır ve sorunlarda uyarı alırsınız.',
      monSaved: 'İzlenecek alan adı kaydedildi. İlk tarama 24 saat içinde yapılır.',
      monVerify: 'Bu alan adı hesabınızda doğrulanmamış. Önce doğrulayın: /verify',
      monNoSub: 'Etkin bir Pro veya Enterprise aboneliği bulunamadı.',
      monInvalid: 'Geçerli bir alan adı girin.',
      alertsNone: 'Henüz uyarı yok.',
      badgeNone: 'Rozet için önce alan adınızı doğrulayın: /verify',
      badgeFree: 'Rozet Pro ve Enterprise planlarında etkin olur; şimdilik "doğrulanmadı" görünür.',
      badgeCopy: 'Kodu kopyala', badgeCopied: 'Kopyalandı',
      alertsUnavailable: 'Uyarılar şu anda okunamıyor.',
      al_score_drop: 'Skor düştü: {from} → {to}',
      al_ssl_expiry: 'SSL sertifikasının bitmesine {daysLeft} gün kaldı',
      al_domain_expiry: 'Alan adı kaydının bitmesine {daysLeft} gün kaldı',
      al_blacklist: 'Kara listede görünüyor ({source})',
      al_downtime: 'Site erişilemiyor ({reason})',
      al_recovered: 'Site yeniden erişilebilir',
      pwShort: 'Şifre en az 10 karakter olmalı.', pwLong: 'Şifre çok uzun.', pwMismatch: 'Şifreler eşleşmiyor.',
      pwWeak: 'Bu şifre çok zayıf; daha uzun ve tahmin edilmesi zor bir şifre seçin.',
      pwOk: 'Şifreniz güncellendi.', pwAuth: 'Oturumunuzun süresi dolmuş. Lütfen yeniden giriş yapın.',
      dnsChecking: 'Sorgulanıyor…', dnsInvalid: 'Geçerli bir alan adı girin.',
      dnsUnavailable: 'Doğrulama servisi şu an yayında değil.', dnsTimeout: 'Sorgu zaman aşımına uğradı.',
      spfFound: 'SPF kaydı bulundu', spfMissing: 'SPF kaydı bulunamadı',
      dmarcFound: 'DMARC kaydı bulundu', dmarcMissing: 'DMARC politikası yok', policy: 'Politika', checked: 'Kontrol edildi:',
      cfToken: "Cloudflare API token'ınızı girin (Zone > Transform Rules > Edit yetkili).",
      cfOk: function (f, d) { return f.toUpperCase() + ' kuralı eklendi (' + d + '). Geri alma: Cloudflare > Rules > Transform Rules.'; },
      cfFail: 'Düzeltme uygulanamadı. Alan adını ve token yetkilerini kontrol edin.',
      demoOff: 'Örnek veri modunda bu işlem devre dışı.'
    },
    en: {
      'nav.home': 'Home', 'nav.sections': 'Dashboard sections',
      'nav.overview': 'Overview', 'nav.scans': 'Scans', 'nav.billing': 'Billing',
      'nav.security': 'Security', 'nav.notifications': 'Notifications', 'nav.tools': 'Tools', 'nav.support': 'Support',
      'demo.banner': 'SAMPLE DATA — opened with ?demo=1; no value here belongs to a real account.',
      'gate.loading': 'Loading your dashboard…', 'gate.title': 'Sign in to your dashboard',
      'gate.desc': 'Enter your email and we will send a one-time sign-in link. To sign in with a password, use "Sign In" on the home page.',
      'gate.email': 'Email', 'gate.send': 'Send sign-in link', 'gate.password': 'Sign in with password',
      'gate.downTitle': 'Dashboard unavailable',
      'gate.down': 'The account service cannot be reached right now. Your scan history is not lost; please try again shortly.',
      'profile.quota': 'Scans remaining', 'profile.upgrade': 'Upgrade to PRO', 'profile.manage': 'Manage Plan', 'profile.logout': 'Sign out',
      'overview.title': 'Overview', 'overview.score': 'Security Score', 'overview.scoreSub': 'Latest completed scan',
      'overview.total': 'Total Scans', 'overview.month': 'This month', 'overview.critical': 'Critical Issues',
      'overview.criticalSub': 'Critical findings in the latest scan', 'overview.last': 'Last Scan', 'overview.quick': 'Quick Scan',
      'overview.trend': 'Score Trend',
      'scans.title': 'Recent Scans', 'scans.filter': 'Status filter', 'scans.all': 'All', 'scans.completed': 'Completed',
      'scans.failed': 'Failed', 'scans.search': 'Search domain', 'scans.date': 'Date', 'scans.domain': 'Domain',
      'scans.score': 'Score', 'scans.owasp': 'OWASP Issues', 'scans.status': 'Status', 'scans.pdf': 'PDF', 'scans.detail': 'Details',
      'scans.more': 'Load more',
      'billing.title': 'Subscription & Billing', 'billing.current': 'Current Plan', 'billing.plan': 'Plan',
      'billing.price': 'Price', 'billing.renewal': 'Renewal', 'billing.change': 'Upgrade Plan',
      'billing.cancel': 'Downgrade / Cancel Request', 'billing.invoices': 'Invoices & Company Details',
      'billing.invoiceList': 'Invoice list (PDF)', 'billing.company': 'Edit company name and tax ID',
      'billing.selfServe': 'Self-service downgrade / cancel (iyzico)',
      'billing.soonNote': 'For now these are handled by our support team. Email destek@cyberlionai.com for invoices, company details or cancellation; cancellations follow the distance sales agreement.',
      'common.soon': 'Coming soon',
      'security.title': 'Security Settings', 'security.password': 'Change Password', 'security.new': 'New password',
      'security.repeat': 'New password (again)', 'security.save': 'Update Password',
      'security.pwNote': 'At least 10 characters. If you signed in with a link, you can set your first password here.',
      'security.access': 'Access', 'security.thisDevice': 'This device', 'security.active': 'Active',
      'security.sessions': 'Other sessions', 'security.twofa': 'Two-factor authentication (2FA)', 'security.apiToken': 'API token (Enterprise)',
      'security.cfNote': 'Cloudflare 1-Click Fix is available today in Tools; it uses your own Cloudflare token, which we never store.',
      'notif.title': 'Notifications', 'notif.weekly': 'Daily monitoring and alerts', 'notif.email': 'Email notification preferences',
      'mon.domain': 'Domain to monitor', 'mon.save': 'Save',
      'alerts.title': 'Monitoring alerts', 'alerts.markRead': 'Mark all as read',
      'tools.title': 'Tools', 'tools.dnsTitle': 'SPF & DMARC Check',
      'badge.title': 'Live Trust Badge',
      'badge.desc': 'A badge showing the latest scan score and date of your verified domain. It turns grey below 80. Included in the Pro and Enterprise plans.',
      'tools.dnsDesc': "Check your domain's SPF and DMARC records against email spoofing. The query runs server-side against real DNS.",
      'tools.domain': 'Domain', 'tools.check': 'Check',
      'tools.spfHow': 'Add to the root domain as a TXT record (example):',
      'tools.dmarcHow': 'Add a TXT record on the _dmarc subdomain (example):',
      'tools.cfTitle': '1-Click Fix via Cloudflare', 'tools.cfToken': 'Your Cloudflare API token', 'tools.cfFix': 'Fix type',
      'tools.cfAll': 'All (HSTS + CSP + X-Frame)', 'tools.cfApply': 'Apply in 1 Click',
      'tools.cfWarn': 'Your token is never stored; it is used for this request only. To roll back, delete the CyberLion rule in Cloudflare Dashboard > Rules > Transform Rules. The CSP option can block your site\'s external resources (fonts, analytics…); try it on staging first.',
      'support.title': 'Support', 'support.mail': 'Email support', 'support.assistant': 'Live Assistant',
      'support.assistantSub': 'Bottom-right on the home page; FAQs included',
      'support.contact': 'Contact form', 'support.contactSub': 'Weekdays 09:00–18:00 (GMT+3)',
      'footer.copy': '© 2026 Ali Kotan - Sole Proprietorship', 'footer.legal': 'Legal',
      'footer.kvkk': 'KVKK Privacy Notice', 'footer.privacy': 'Privacy Policy', 'footer.distance': 'Distance Sales',
      'footer.refund': 'Delivery & Returns', 'footer.terms': 'Terms of Use',
      title: 'My Dashboard',
      quotaMonth: 'Scans left this month', quotaUnlimited: 'Unlimited',
      sending: 'Sending…', sent: 'Sign-in link sent. Please check your email.',
      badEmail: 'Enter a valid email address.', tooMany: 'Too many attempts. Please try again later.',
      failed: 'Could not complete. Please try again shortly.', loading: 'Loading…',
      empty: 'No scans yet. Start your first scan from the home page.', emptyFiltered: 'No scans match this filter.',
      scansDown: 'Scan history cannot be read right now; your records are not lost.',
      lockFree: function (n) { return n + ' more scans. Upgrade to PRO for full history.'; },
      pdf: 'Download', detail: 'Show', hide: 'Hide', noFindings: 'No findings were recorded for this scan.',
      evidence: 'Evidence', other: 'Uncategorised', scoreless: 'no score',
      findings: function (n, g) { return n + ' findings · ' + g + ' categories'; },
      state: { completed: 'completed', failed: 'failed', pending: 'pending', running: 'running' },
      sev: { critical: 'critical', high: 'high', medium: 'medium', low: 'low', info: 'info' },
      highToo: function (n) { return '+' + n + ' high severity'; },
      noScore: 'No scored scan yet',
      trendNote: function (n) { return 'Scores of ' + n + ' scans, oldest to newest.'; },
      trendThin: 'A trend needs at least two scored scans.',
      vsPrev: function (d) { return (d > 0 ? '+' : '') + d + ' vs previous scan'; },
      plans: { free: 'Free', pro: 'Pro', enterprise: 'Enterprise', unknown: 'Unavailable' },
      perMonth: '/mo', vatEx: 'excl. VAT', freeForever: 'Free forever',
      monthly: function (d) { return 'Monthly · since ' + d; },
      planUnknown: 'Plan details cannot be read right now. If you have paid, your subscription is not affected.',
      testMode: 'Test mode', toEnterprise: 'Upgrade to Enterprise',
      billNoteFree: 'You are on the free plan. PRO unlocks 50 scans a month, OWASP-grouped PDF reports and score trends.',
      billNotePaid: 'Invoice and cancellation requests are handled via destek@cyberlionai.com for now.',
      weeklyOn: 'Included in your plan: {domain} is scanned passively every day. Score drops, SSL and domain expiry, and blacklist alerts are listed below.',
      weeklyOnUptime: ' Enterprise: site availability is checked every 5 minutes.',
      weeklyNoDomain: 'Included in your plan. Enter the domain to monitor below; it must be verified in your account.',
      weeklyOff: 'On the Pro and Enterprise plans your domain is scanned every day and you are alerted to problems.',
      monSaved: 'Domain to monitor saved. The first scan runs within 24 hours.',
      monVerify: 'This domain is not verified in your account. Verify it first: /verify',
      monNoSub: 'No active Pro or Enterprise subscription was found.',
      monInvalid: 'Enter a valid domain.',
      alertsNone: 'No alerts yet.',
      badgeNone: 'Verify your domain first to get a badge: /verify',
      badgeFree: 'The badge activates on the Pro and Enterprise plans; until then it shows "not verified".',
      badgeCopy: 'Copy code', badgeCopied: 'Copied',
      alertsUnavailable: 'Alerts cannot be read right now.',
      al_score_drop: 'Score dropped: {from} → {to}',
      al_ssl_expiry: 'SSL certificate expires in {daysLeft} days',
      al_domain_expiry: 'Domain registration expires in {daysLeft} days',
      al_blacklist: 'Appears on a blacklist ({source})',
      al_downtime: 'Site unreachable ({reason})',
      al_recovered: 'Site reachable again',
      pwShort: 'Password must be at least 10 characters.', pwLong: 'Password is too long.', pwMismatch: 'Passwords do not match.',
      pwWeak: 'This password is too weak; choose a longer, harder-to-guess one.',
      pwOk: 'Your password has been updated.', pwAuth: 'Your session has expired. Please sign in again.',
      dnsChecking: 'Checking…', dnsInvalid: 'Enter a valid domain name.',
      dnsUnavailable: 'The verification service is not available right now.', dnsTimeout: 'The check timed out.',
      spfFound: 'SPF record found', spfMissing: 'No SPF record found',
      dmarcFound: 'DMARC record found', dmarcMissing: 'No DMARC policy', policy: 'Policy', checked: 'Checked:',
      cfToken: 'Enter your Cloudflare API token (with Zone > Transform Rules > Edit).',
      cfOk: function (f, d) { return f.toUpperCase() + ' rule added (' + d + '). Roll back: Cloudflare > Rules > Transform Rules.'; },
      cfFail: 'The fix could not be applied. Check the domain and token permissions.',
      demoOff: 'Disabled in sample-data mode.'
    }
  };

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  var params = new URLSearchParams(location.search);
  var lang = (function () {
    var p = params.get('lang'), s = store.get('preferredLang');
    if (p === 'tr' || p === 'en') return p;
    if (s === 'tr' || s === 'en') return s;
    return (navigator.language || 'en').toLowerCase().indexOf('tr') === 0 ? 'tr' : 'en';
  })();
  function t(key) { var v = DICT[lang][key]; return v === undefined ? DICT.tr[key] : v; }
  var $ = function (id) { return document.getElementById(id); };

  function applyLang() {
    document.documentElement.setAttribute('lang', lang);
    document.querySelectorAll('[data-i18n]').forEach(function (n) {
      var v = DICT[lang][n.getAttribute('data-i18n')];
      if (typeof v === 'string') n.textContent = v;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (n) {
      var v = DICT[lang][n.getAttribute('data-i18n-placeholder')];
      if (typeof v === 'string') n.setAttribute('placeholder', v);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (n) {
      var v = DICT[lang][n.getAttribute('data-i18n-aria')];
      if (typeof v === 'string') n.setAttribute('aria-label', v);
    });
    document.querySelectorAll('.lang button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-lang') === lang ? 'true' : 'false');
    });
    document.title = t('title') + ' | Cyber Lion AI';
  }

  /* ================= yardımcılar ================= */
  function tag(name, cls, text) {
    var n = document.createElement(name);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function icon(cls) { var i = tag('i', cls); i.setAttribute('aria-hidden', 'true'); return i; }
  function setMsg(el, text, kind) { el.textContent = text || ''; el.className = 'msg' + (kind ? ' msg--' + kind : ''); }
  function locale() { return lang === 'tr' ? 'tr-TR' : 'en-US'; }
  function fmtDate(iso, withTime) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '—';
    try {
      var s = d.toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric' });
      return withTime ? s + ' ' + d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : s;
    } catch (e) { return String(iso).slice(0, 10); }
  }
  function fmtTry(n) {
    try { return '₺' + Number(n).toLocaleString(locale()); } catch (e) { return '₺' + n; }
  }
  /* Skor bandı api/_lib/report.js RISK_BANDS ile aynı: panoda ve PDF'te aynı renk. */
  function band(score) {
    if (typeof score !== 'number') return null;
    if (score >= 85) return 'low';
    if (score >= 70) return 'medium';
    if (score >= 50) return 'high';
    return 'critical';
  }
  function getJSON(url) {
    return fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (d) { return { status: r.status, ok: r.ok, data: d }; });
      });
  }
  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) { return { status: r.status, ok: r.ok, data: d }; });
    });
  }

  var OWASP = {
    tr: { A01: 'Bozuk Erişim Denetimi', A02: 'Kriptografik Hatalar', A03: 'Enjeksiyon', A04: 'Güvensiz Tasarım',
      A05: 'Hatalı Güvenlik Yapılandırması', A06: 'Güncelliğini Yitirmiş Bileşenler', A07: 'Kimlik Doğrulama Hataları',
      A08: 'Yazılım ve Veri Bütünlüğü Hataları', A09: 'Günlükleme ve İzleme Eksikleri', A10: 'Sunucu Taraflı İstek Sahteciliği' },
    en: { A01: 'Broken Access Control', A02: 'Cryptographic Failures', A03: 'Injection', A04: 'Insecure Design',
      A05: 'Security Misconfiguration', A06: 'Vulnerable and Outdated Components', A07: 'Identification and Authentication Failures',
      A08: 'Software and Data Integrity Failures', A09: 'Security Logging and Monitoring Failures', A10: 'Server-Side Request Forgery' }
  };

  /* Plan başına tablo satırı. FREE'nin kotası zaten 5 tarama; fazlası olursa
     bulanık gösterilir. ENTERPRISE sayfalı ve süzgeçli. */
  var ROW_LIMIT = { free: 5, pro: 50, enterprise: Infinity, unknown: 5 };
  var FIRST_PAGE = 50; /* sunucunun panel üst sınırı (PANEL_MAX_LIMIT) */
  var AUTO_DETAIL = 8; /* OWASP sütunu için kendiliğinden açılan ayrıntı sayısı */

  /* ================= durum ================= */
  var S = {
    demo: params.get('demo') === '1',
    me: null, sub: null, plan: 'free',
    items: [], trend: [], hasMore: false, offset: 0, scansFailed: false,
    filter: '', query: '', details: {}, open: {}, latestDetail: null
  };

  /* ================= örnek veri (yalnızca ?demo=1) ================= */
  function demoData() {
    var now = Date.now(), day = 864e5;
    var domains = ['ornek-magaza.com', 'ornek-magaza.com', 'blog.ornek.com', 'ornek-magaza.com', 'api.ornek.com', 'ornek-magaza.com', 'blog.ornek.com'];
    var scores = [82, 76, null, 71, 64, 69, 58];
    var items = domains.map(function (d, i) {
      return { id: 'demo-' + i, domain: d, status: scores[i] === null ? 'failed' : 'completed', score: scores[i],
        createdAt: new Date(now - i * 4 * day).toISOString() };
    });
    var trend = items.filter(function (x) { return x.score !== null; }).reverse()
      .map(function (x) { return { id: x.id, domain: x.domain, score: x.score, createdAt: x.createdAt }; });
    var detail = { severityCounts: { critical: 1, high: 2, medium: 3, low: 1, info: 0 }, totalFindings: 7, groups: [
      { category: 'A02', findings: [{ severity: 'critical', title: 'HSTS başlığı yok', description: 'Tarayıcı ilk isteği HTTP üzerinden yapabilir.', fixCode: 'Strict-Transport-Security: max-age=31536000; includeSubDomains' }] },
      { category: 'A05', findings: [{ severity: 'high', title: 'Content-Security-Policy yok', description: 'XSS etkisini sınırlayan politika tanımlı değil.' },
        { severity: 'medium', title: 'X-Frame-Options yok', description: 'Sayfa başka sitelerde çerçevelenebilir.' }] }
    ] };
    return {
      me: { authenticated: true, available: true, user: { email: 'ornek@sirket.com' }, quota: { used: 3, limit: 5, remaining: 2 } },
      sub: { plan: 'pro', priceTry: 299, subscriptions: [{ domain: 'ornek-magaza.com', plan: 'pro', status: 'ACTIVE', testMode: true, createdAt: new Date(now - 40 * day).toISOString() }] },
      items: items, trend: trend, detail: detail
    };
  }

  /* ================= giriş kapısı ================= */
  function showGate(which) {
    $('gate').hidden = false; $('app').hidden = true;
    ['gateLoading', 'gateLogin', 'gateDown'].forEach(function (id) { $(id).hidden = id !== which; });
  }
  function bindLogin() {
    $('loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = $('loginMsg'), btn = $('loginBtn');
      var email = $('loginEmail').value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { setMsg(msg, t('badEmail'), 'err'); return; }
      setMsg(msg, t('sending')); btn.disabled = true;
      postJSON('/api/auth/magiclink', { email: email }).then(function (r) {
        btn.disabled = false;
        /* Uç, e-postanın kayıtlı olup olmadığını bilerek sızdırmıyor; arayüz de aynı mesajı veriyor. */
        if (r.ok) setMsg(msg, t('sent'), 'ok');
        else setMsg(msg, r.status === 429 ? t('tooMany') : t('failed'), 'err');
      }).catch(function () { btn.disabled = false; setMsg(msg, t('failed'), 'err'); });
    });
  }

  /* ================= A) profil ================= */
  function renderProfile() {
    var email = (S.me && S.me.user && S.me.user.email) || '';
    $('profileEmail').textContent = email || '—';
    $('avatar').textContent = (email.charAt(0) || '?').toUpperCase();
    $('pwUser').value = email;

    var pill = $('planPill');
    pill.className = 'pill pill--' + (S.plan === 'unknown' ? 'free' : S.plan);
    pill.textContent = S.plan === 'unknown' ? '—' : S.plan.toUpperCase();
    $('planPrice').textContent = S.plan === 'free' ? t('freeForever')
      : (S.sub && S.sub.priceTry ? fmtTry(S.sub.priceTry) + t('perMonth') + ' · ' + t('vatEx') : '');

    var paid = S.plan === 'pro' || S.plan === 'enterprise';
    $('upgradeBtn').hidden = paid;
    $('manageBtn').hidden = !paid;

    /* Kota sunucudan, plana göre (api/_lib/entitlement.js): free ömür boyu,
       Pro aylık, Enterprise sınırsız. */
    var q = S.me && S.me.quota;
    $('quotaBox').hidden = !q;
    if (q) {
      var label = $('quotaBox').querySelector('[data-i18n="profile.quota"]');
      label.textContent = q.period === 'month' ? t('quotaMonth') : DICT[lang]['profile.quota'];
      if (q.unlimited) {
        $('quotaText').textContent = t('quotaUnlimited');
        $('quotaFill').style.width = '100%';
        $('quotaBar').hidden = true;
      } else {
        $('quotaBar').hidden = false;
        $('quotaText').textContent = q.remaining + '/' + q.limit;
        $('quotaFill').style.width = Math.max(0, Math.min(100, (q.remaining / q.limit) * 100)) + '%';
        $('quotaBar').setAttribute('aria-valuemax', String(q.limit));
        $('quotaBar').setAttribute('aria-valuenow', String(q.remaining));
      }
    }
  }

  /* ================= B) genel bakış ================= */
  function renderOverview() {
    var tr = S.trend || [];
    var last = tr.length ? tr[tr.length - 1] : null;
    var prev = tr.length > 1 ? tr[tr.length - 2] : null;
    var scoreEl = $('statScore'), trendEl = $('statTrend');
    trendEl.textContent = '';
    if (last) {
      scoreEl.textContent = last.score;
      scoreEl.className = 'v-' + band(last.score);
      $('statScoreSub').textContent = last.domain + ' · ' + fmtDate(last.createdAt);
      if (prev) {
        var d = last.score - prev.score;
        var ic = icon(d > 0 ? 'fa-solid fa-arrow-trend-up' : d < 0 ? 'fa-solid fa-arrow-trend-down' : 'fa-solid fa-minus');
        trendEl.className = d > 0 ? 'trend-up' : d < 0 ? 'trend-down' : 'trend-flat';
        trendEl.appendChild(ic);
        trendEl.setAttribute('title', t('vsPrev')(d));
        trendEl.appendChild(tag('span', 'sr-only', t('vsPrev')(d)));
      }
    } else {
      scoreEl.textContent = '—'; scoreEl.className = '';
      $('statScoreSub').textContent = t('noScore');
    }

    var items = S.items;
    var now = new Date();
    var month = items.filter(function (x) {
      var d = new Date(x.createdAt);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
    var more = S.hasMore && S.offset <= FIRST_PAGE;
    /* Liste okunamadıysa "0" yazmak "hiç taramanız yok" demek olur; bilinmiyor. */
    $('statTotal').textContent = S.scansFailed ? '—' : more ? FIRST_PAGE + '+' : String(items.length);
    $('statMonth').textContent = S.scansFailed ? '—' : more && month === items.length ? month + '+' : String(month);
    $('statLast').textContent = items.length ? fmtDate(items[0].createdAt, true) : '—';

    var det = S.latestDetail;
    if (det && det.severityCounts) {
      var c = det.severityCounts.critical || 0, h = det.severityCounts.high || 0;
      $('statCritical').textContent = c;
      $('statCritical').className = c ? 'v-critical' : 'v-low';
      $('statCriticalSub').textContent = h ? t('highToo')(h) : DICT[lang]['overview.criticalSub'];
    } else {
      $('statCritical').textContent = '—'; $('statCritical').className = '';
    }
    drawTrend(tr);
  }

  function drawTrend(points) {
    var card = $('trendCard'), host = $('trendChart'), note = $('trendNote');
    host.textContent = '';
    if (!points || !points.length) { card.hidden = true; return; }
    card.hidden = false;
    if (points.length < 2) { note.textContent = t('trendThin'); return; }
    note.textContent = t('trendNote')(points.length);
    var W = 760, H = 180, pl = 34, pr = 10, pt = 12, pb = 22, ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', t('trendNote')(points.length));
    var x = function (i) { return pl + (i * (W - pl - pr)) / (points.length - 1); };
    /* Y ekseni 0-100 sabit: 2 puanlık oynama uçurum gibi görünmesin. */
    var y = function (v) { return pt + (1 - v / 100) * (H - pt - pb); };
    [0, 50, 70, 85, 100].forEach(function (v) {
      var l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', pl); l.setAttribute('x2', W - pr); l.setAttribute('y1', y(v)); l.setAttribute('y2', y(v));
      l.setAttribute('stroke', 'rgba(255,255,255,.07)'); svg.appendChild(l);
      var tx = document.createElementNS(ns, 'text');
      tx.setAttribute('x', 4); tx.setAttribute('y', y(v) + 4); tx.setAttribute('fill', 'rgba(160,160,176,.9)'); tx.setAttribute('font-size', '10');
      tx.textContent = String(v); svg.appendChild(tx);
    });
    var area = document.createElementNS(ns, 'path');
    var line = points.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.score).toFixed(1); }).join(' ');
    area.setAttribute('d', line + ' L' + x(points.length - 1).toFixed(1) + ' ' + y(0) + ' L' + x(0).toFixed(1) + ' ' + y(0) + ' Z');
    area.setAttribute('fill', 'rgba(212,175,55,.08)'); svg.appendChild(area);
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', line); path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#d4af37');
    path.setAttribute('stroke-width', '2'); path.setAttribute('stroke-linejoin', 'round'); svg.appendChild(path);
    points.forEach(function (p, i) {
      var c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', x(i).toFixed(1)); c.setAttribute('cy', y(p.score).toFixed(1)); c.setAttribute('r', '3.2'); c.setAttribute('fill', '#ffdf00');
      var ti = document.createElementNS(ns, 'title');
      ti.textContent = p.domain + ' — ' + p.score + ' (' + fmtDate(p.createdAt) + ')';
      c.appendChild(ti); svg.appendChild(c);
    });
    host.appendChild(svg);
  }

  /* ================= C) tarama tablosu ================= */
  function visibleItems() {
    var q = S.query.trim().toLowerCase();
    return S.items.filter(function (x) {
      if (S.filter && x.status !== S.filter) return false;
      if (q && String(x.domain || '').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function owaspCell(td, job) {
    td.textContent = '';
    if (job.status !== 'completed') { td.appendChild(tag('span', 'muted', '—')); return; }
    var d = S.details[job.id];
    if (d && d !== 'loading' && d !== 'error') {
      td.appendChild(tag('span', null, t('findings')(d.totalFindings || 0, (d.groups || []).length)));
    } else if (d === 'loading') {
      td.appendChild(icon('fa-solid fa-spinner fa-spin muted'));
    } else {
      td.appendChild(tag('span', 'muted', '—'));
    }
  }

  function fetchDetail(job) {
    if (S.demo) { S.details[job.id] = demoData().detail; return Promise.resolve(S.details[job.id]); }
    if (S.details[job.id] && S.details[job.id] !== 'error') return Promise.resolve(S.details[job.id]);
    S.details[job.id] = 'loading';
    return getJSON('/api/panel/scans?id=' + encodeURIComponent(job.id)).then(function (r) {
      S.details[job.id] = r.ok && r.data ? r.data : 'error';
      return S.details[job.id];
    }).catch(function () { S.details[job.id] = 'error'; return 'error'; });
  }

  function renderDetail(cell, d) {
    cell.textContent = '';
    if (!d || d === 'error') { cell.appendChild(tag('p', 'note', t('failed'))); return; }
    if (!d.totalFindings) { cell.appendChild(tag('p', 'note', t('noFindings'))); return; }
    var names = OWASP[lang];
    d.groups.forEach(function (g) {
      var wrap = tag('div', 'group');
      wrap.appendChild(tag('p', 'group__h', g.category === 'other' ? t('other') : g.category + ' — ' + (names[g.category] || g.category)));
      g.findings.forEach(function (f) {
        var it = tag('div', 'find'), head = tag('div', 'find__t');
        head.appendChild(tag('span', 'sev sev--' + f.severity, (t('sev')[f.severity]) || f.severity));
        head.appendChild(tag('strong', null, f.title || ''));
        it.appendChild(head);
        if (f.description) it.appendChild(tag('p', 'find__d', f.description));
        if (f.evidence) it.appendChild(tag('p', 'find__d', t('evidence') + ': ' + f.evidence));
        if (f.fixCode) it.appendChild(tag('pre', 'find__fix', f.fixCode));
        wrap.appendChild(it);
      });
      cell.appendChild(wrap);
    });
  }

  function renderTable() {
    var body = $('scanBody'), msg = $('scanMsg');
    body.textContent = '';
    var rows = visibleItems();
    var limit = ROW_LIMIT[S.plan] || 5;
    var locked = S.plan === 'free' || S.plan === 'unknown' ? Math.max(0, rows.length - limit) : 0;
    var shown = S.plan === 'pro' ? rows.slice(0, limit) : rows;

    if (S.scansFailed) setMsg(msg, t('scansDown'), 'err');
    else if (!S.items.length) setMsg(msg, t('empty'));
    else if (!rows.length) setMsg(msg, t('emptyFiltered'));
    else setMsg(msg, '');

    shown.forEach(function (job, i) {
      var isLocked = locked && i >= limit;
      var tr = tag('tr', isLocked ? 'locked' : null);
      if (isLocked) tr.setAttribute('aria-hidden', 'true');
      tr.appendChild(tag('td', null, fmtDate(job.createdAt, true)));
      tr.appendChild(tag('td', 'domain', job.domain));
      var tdScore = tag('td'), b = band(job.score);
      tdScore.appendChild(b ? tag('span', 'score score--' + b, job.score) : tag('span', 'state', t('scoreless')));
      tr.appendChild(tdScore);
      var tdO = tag('td'); owaspCell(tdO, job); tr.appendChild(tdO);
      tr.appendChild(tag('td', 'state state--' + job.status, (t('state')[job.status]) || job.status));

      var tdPdf = tag('td');
      if (job.status === 'completed' && !S.demo) {
        var a = tag('a', 'link-btn');
        a.appendChild(icon('fa-solid fa-file-arrow-down'));
        a.appendChild(document.createTextNode(t('pdf')));
        a.setAttribute('href', '/api/report?jobId=' + encodeURIComponent(job.id) + '&lang=' + lang);
        tdPdf.appendChild(a);
      } else tdPdf.appendChild(tag('span', 'muted', '—'));
      tr.appendChild(tdPdf);

      var tdD = tag('td');
      if (job.status === 'completed') {
        var btn = tag('button', 'link-btn', S.open[job.id] ? t('hide') : t('detail'));
        btn.type = 'button';
        btn.setAttribute('aria-expanded', S.open[job.id] ? 'true' : 'false');
        btn.addEventListener('click', function () {
          S.open[job.id] = !S.open[job.id];
          if (S.open[job.id]) fetchDetail(job).then(renderTable);
          renderTable();
        });
        tdD.appendChild(btn);
      } else tdD.appendChild(tag('span', 'muted', '—'));
      tr.appendChild(tdD);
      body.appendChild(tr);

      if (S.open[job.id] && !isLocked) {
        var dr = tag('tr', 'detail-row'), dc = tag('td');
        dc.colSpan = 7;
        var d = S.details[job.id];
        if (d === 'loading' || !d) dc.appendChild(tag('p', 'note', t('loading')));
        else renderDetail(dc, d);
        dr.appendChild(dc); body.appendChild(dr);
      }
    });

    $('lockOver').hidden = !locked;
    if (locked) $('lockText').textContent = t('lockFree')(locked);
    $('scanToolbar').hidden = S.plan !== 'enterprise';
    $('scanMore').hidden = !(S.plan === 'enterprise' && S.hasMore);
  }

  /* OWASP sütunu: ilk birkaç tamamlanmış satırın ayrıntısı arka planda,
     ikişer ikişer (panel ucu kullanıcı başına dakikada 60 istek sınırlı). */
  function prefetchDetails() {
    var queue = visibleItems().filter(function (x) { return x.status === 'completed' && !S.details[x.id]; }).slice(0, AUTO_DETAIL);
    function next() {
      var job = queue.shift();
      if (!job) return Promise.resolve();
      return fetchDetail(job).then(function () { renderTable(); return next(); });
    }
    return Promise.all([next(), next()]);
  }

  function loadScans(append) {
    var limit = append ? 20 : FIRST_PAGE;
    return getJSON('/api/panel/scans?limit=' + limit + '&offset=' + (append ? S.offset : 0)).then(function (r) {
      if (r.status === 401) { showGate('gateLogin'); return false; }
      if (!r.ok || !r.data) { S.scansFailed = true; return true; }
      S.scansFailed = false;
      S.items = append ? S.items.concat(r.data.items) : r.data.items;
      if (!append) S.trend = r.data.trend || [];
      S.hasMore = !!r.data.hasMore;
      S.offset = r.data.offset + r.data.items.length;
      return true;
    }).catch(function () { S.scansFailed = true; return true; });
  }

  function loadLatestDetail() {
    var last = S.trend.length ? S.trend[S.trend.length - 1] : null;
    if (!last) return Promise.resolve();
    return fetchDetail({ id: last.id }).then(function (d) { S.latestDetail = d && d !== 'error' ? d : null; });
  }

  function bindTable() {
    document.querySelectorAll('.chip').forEach(function (c) {
      c.addEventListener('click', function () {
        document.querySelectorAll('.chip').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        c.setAttribute('aria-pressed', 'true');
        S.filter = c.getAttribute('data-filter') || '';
        renderTable(); prefetchDetails();
      });
    });
    $('scanSearch').addEventListener('input', function () { S.query = this.value; renderTable(); });
    $('scanMore').addEventListener('click', function () {
      var btn = this; btn.disabled = true;
      loadScans(true).then(function () { btn.disabled = false; renderTable(); prefetchDetails(); });
    });
  }

  /* ================= D) abonelik ================= */
  function renderBilling() {
    $('billPlan').textContent = t('plans')[S.plan] || S.plan;
    if (S.plan === 'unknown') {
      $('billPrice').textContent = '—'; $('billRenewal').textContent = '—';
      $('billNote').textContent = t('planUnknown');
    } else if (S.plan === 'free') {
      $('billPrice').textContent = fmtTry(0); $('billRenewal').textContent = '—';
      $('billNote').textContent = t('billNoteFree');
    } else {
      $('billPrice').textContent = fmtTry(S.sub.priceTry) + t('perMonth') + ' (' + t('vatEx') + ')';
      var subs = (S.sub && S.sub.subscriptions) || [];
      var first = subs.slice().sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); })[0];
      /* Yenileme günü iyzico'da tutuluyor ve bu uç döndürmüyor; tahmini bir
         tarih yazmak yerine başlangıç tarihi ve döngü gösteriliyor. */
      $('billRenewal').textContent = first ? t('monthly')(fmtDate(first.createdAt)) : '—';
      $('billNote').textContent = t('billNotePaid');
    }

    var list = $('subList'); list.textContent = '';
    var subs2 = (S.sub && S.sub.subscriptions) || [];
    list.hidden = !subs2.length;
    subs2.forEach(function (s) {
      var li = tag('li');
      li.appendChild(icon('fa-solid fa-globe'));
      li.appendChild(tag('strong', null, s.domain || '—'));
      li.appendChild(tag('span', 'pill pill--' + (s.plan === 'enterprise' ? 'enterprise' : 'pro'), String(s.plan || '').toUpperCase()));
      if (s.status) li.appendChild(tag('span', 'muted', s.status));
      if (s.testMode) li.appendChild(tag('span', 'pill pill--test', t('testMode')));
      list.appendChild(li);
    });

    var up = $('billUpgrade');
    up.hidden = S.plan === 'enterprise';
    up.lastChild.textContent = S.plan === 'pro' ? t('toEnterprise') : DICT[lang]['billing.change'];
    $('billCancel').hidden = !(S.plan === 'pro' || S.plan === 'enterprise');
  }

  /* ================= E) güvenlik ================= */
  function deviceLabel() {
    var ua = navigator.userAgent || '';
    var br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
      : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    var os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS'
      : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
    return br + (os ? ' · ' + os : '');
  }

  function bindPassword() {
    $('pwForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = $('pwMsg'), btn = $('pwBtn');
      if (S.demo) { setMsg(msg, t('demoOff'), 'err'); return; }
      var a = $('pwNew').value, b = $('pwRepeat').value;
      if (a.length < 10) { setMsg(msg, t('pwShort'), 'err'); return; }
      if (a !== b) { setMsg(msg, t('pwMismatch'), 'err'); return; }
      setMsg(msg, t('sending')); btn.disabled = true;
      postJSON('/api/auth/password', { password: a }).then(function (r) {
        btn.disabled = false;
        if (r.ok) { setMsg(msg, t('pwOk'), 'ok'); $('pwNew').value = ''; $('pwRepeat').value = ''; return; }
        var code = r.data && r.data.error && r.data.error.code;
        if (r.status === 401) setMsg(msg, t('pwAuth'), 'err');
        else if (r.status === 429) setMsg(msg, t('tooMany'), 'err');
        else if (code === 'password_too_short') setMsg(msg, t('pwShort'), 'err');
        else if (code === 'password_too_long') setMsg(msg, t('pwLong'), 'err');
        else if (code === 'weak_password') setMsg(msg, t('pwWeak'), 'err');
        else setMsg(msg, t('failed'), 'err');
      }).catch(function () { btn.disabled = false; setMsg(msg, t('failed'), 'err'); });
    });
  }

  /* ================= F) bildirimler ================= */
  function monitoredDomain() {
    var subs = (S.sub && S.sub.subscriptions) || [];
    for (var i = 0; i < subs.length; i++) if (subs[i].domain) return subs[i].domain;
    return null;
  }

  function fill(s, p) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return p && p[k] !== undefined && p[k] !== null ? p[k] : m; });
  }

  function renderNotifications() {
    var on = S.plan === 'pro' || S.plan === 'enterprise';
    var dom = monitoredDomain();
    $('weeklySwitch').setAttribute('aria-checked', on && dom ? 'true' : 'false');
    var note = !on ? t('weeklyOff') : dom ? fill(t('weeklyOn'), { domain: dom }) : t('weeklyNoDomain');
    if (on && dom && S.plan === 'enterprise') note += t('weeklyOnUptime');
    $('weeklyNote').textContent = note;
    $('monForm').hidden = !on;
    if (on && dom && !$('monDomain').value) $('monDomain').value = dom;
    bindMonitor();
    loadAlerts();
    loadBadges();
  }

  var monBound = false;
  function bindMonitor() {
    if (monBound) return;
    monBound = true;
    $('monForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = $('monMsg');
      var d = normalizeDomain($('monDomain').value);
      if (!d) { setMsg(msg, t('monInvalid'), 'err'); return; }
      $('monBtn').disabled = true;
      postJSON('/api/panel/subscription', { domain: d }).then(function (r) {
        $('monBtn').disabled = false;
        var code = r.data && r.data.error && r.data.error.code;
        if (r.ok) {
          setMsg(msg, t('monSaved'), 'ok');
          var subs = (S.sub && S.sub.subscriptions) || [];
          if (subs[0]) subs[0].domain = r.data.domain;
          renderNotifications();
          return;
        }
        if (code === 'ownership_required') setMsg(msg, t('monVerify'), 'err');
        else if (code === 'no_paid_subscription') setMsg(msg, t('monNoSub'), 'err');
        else if (code === 'invalid_domain') setMsg(msg, t('monInvalid'), 'err');
        else setMsg(msg, t('failed'), 'err');
      }).catch(function () { $('monBtn').disabled = false; setMsg(msg, t('failed'), 'err'); });
    });
    $('alertsRead').addEventListener('click', function () {
      postJSON('/api/panel/alerts', { read: true }).then(function () { loadAlerts(); });
    });
  }

  /* ================= Canlı güven rozeti ================= */
  function loadBadges() {
    var box = $('badgeList');
    if (!box) return;
    getJSON('/api/verify/list').then(function (r) {
      box.textContent = '';
      var items = r.ok && r.data && r.data.items ? r.data.items.filter(function (i) { return i.status === 'verified'; }) : [];
      if (!items.length) { setMsg($('badgeMsg'), t('badgeNone')); return; }
      setMsg($('badgeMsg'), S.plan === 'pro' || S.plan === 'enterprise' ? '' : t('badgeFree'));
      items.forEach(function (it) {
        var src = 'https://www.cyberlionai.com/badge/' + it.domain + '.svg';
        var code = '<a href="https://www.cyberlionai.com/" rel="noopener"><img src="' + src
          + '" alt="Cyber Lion AI güvenlik skoru: ' + it.domain + '" height="22"></a>';
        var wrap = document.createElement('div');
        wrap.style.margin = '0 0 14px';
        var img = document.createElement('img');
        img.src = '/badge/' + encodeURIComponent(it.domain) + '.svg';
        img.alt = it.domain;
        img.height = 22;
        var pre = document.createElement('pre');
        pre.className = 'record';
        pre.textContent = code;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn--ghost';
        btn.textContent = t('badgeCopy');
        btn.addEventListener('click', function () {
          if (navigator.clipboard) navigator.clipboard.writeText(code).then(function () {
            btn.textContent = t('badgeCopied');
            setTimeout(function () { btn.textContent = t('badgeCopy'); }, 1500);
          }, function () {});
        });
        wrap.appendChild(img); wrap.appendChild(pre); wrap.appendChild(btn);
        box.appendChild(wrap);
      });
    }).catch(function () { box.textContent = ''; });
  }

  function loadAlerts() {
    var ul = $('alertsList');
    getJSON('/api/panel/alerts').then(function (r) {
      ul.textContent = '';
      if (!r.ok || !r.data) {
        var e = document.createElement('li'); e.textContent = t('alertsUnavailable'); ul.appendChild(e);
        $('alertsRead').hidden = true;
        return;
      }
      var items = r.data.items || [];
      if (!items.length) {
        var n = document.createElement('li'); n.textContent = t('alertsNone'); ul.appendChild(n);
      }
      items.forEach(function (a) {
        var li = document.createElement('li');
        var dot = document.createElement('span');
        dot.className = 'sev sev--' + (a.severity === 'critical' || a.severity === 'warning' ? a.severity : 'info');
        dot.setAttribute('aria-hidden', 'true');
        var body = document.createElement('span');
        if (!a.read) body.className = 'unread';
        body.textContent = a.domain + ' — ' + fill(t('al_' + a.kind) || a.kind, a.data || {});
        var when = document.createElement('time');
        when.dateTime = a.createdAt;
        try { when.textContent = new Date(a.createdAt).toLocaleString(lang === 'en' ? 'en-GB' : 'tr-TR'); } catch (err) { when.textContent = a.createdAt; }
        body.appendChild(when);
        li.appendChild(dot); li.appendChild(body);
        ul.appendChild(li);
      });
      $('alertsRead').hidden = !(r.data.unread > 0);
    }).catch(function () { $('alertsRead').hidden = true; });
  }

  /* ================= Araçlar: SPF/DMARC ================= */
  function normalizeDomain(raw) {
    var v = String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[\/?#]/)[0];
    if (!v || v.length > 253) return null;
    return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(v) ? v : null;
  }
  function badge(el, ok, label) { el.className = 'badge ' + (ok ? 'badge--ok' : 'badge--fail'); el.textContent = label; }

  function renderDns(res) {
    var spf = (res && res.spf) || {}, dmarc = (res && res.dmarc) || {};
    var spfOk = spf.found === true;
    badge($('spfBadge'), spfOk, spfOk ? t('spfFound') : t('spfMissing'));
    $('spfRecord').hidden = !spfOk || !spf.record; $('spfRecord').textContent = spf.record || '';
    $('spfHow').hidden = spfOk;
    /* p=none etkisiz bir politika: bulunmuş ama "politikası yok" sayılır. */
    var pol = String(dmarc.policy || '').toLowerCase();
    var dOk = dmarc.found === true && pol && pol !== 'none';
    badge($('dmarcBadge'), dOk, dOk ? t('dmarcFound') : t('dmarcMissing'));
    $('dmarcRecord').hidden = !dmarc.found || !dmarc.record; $('dmarcRecord').textContent = dmarc.record || '';
    $('dmarcPolicy').hidden = !dmarc.found || !pol; $('dmarcPolicy').textContent = t('policy') + ': p=' + (pol || '?');
    $('dmarcHow').hidden = dOk;
    $('dnsResult').hidden = false;
  }

  function pollDns(jobId, maxTries) {
    var tries = 0;
    return new Promise(function (resolve, reject) {
      var timer = setInterval(function () {
        tries += 1;
        getJSON('/api/verify-dns?id=' + encodeURIComponent(jobId)).then(function (r) {
          var job = r.ok ? r.data : null;
          if (job && (job.status === 'done' || job.status === 'completed')) { clearInterval(timer); resolve(job.result || job); }
          else if (job && (job.status === 'failed' || job.status === 'error')) { clearInterval(timer); reject({ code: 'error' }); }
        }).catch(function () { /* kayıt henüz görünür değil */ });
        if (tries >= maxTries) { clearInterval(timer); reject({ code: 'timeout' }); }
      }, 2000);
    });
  }

  function bindDns() {
    var busy = false;
    $('dnsForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      var msg = $('dnsMsg');
      var domain = normalizeDomain($('dnsDomain').value);
      if (!domain) { setMsg(msg, t('dnsInvalid'), 'err'); return; }
      busy = true; $('dnsBtn').disabled = true; $('dnsResult').hidden = true;
      setMsg(msg, t('dnsChecking'));
      postJSON('/api/verify-dns', { domain: domain }).then(function (r) {
        if (r.status === 404) throw { code: 'unavailable' };
        if (r.status === 202) {
          if (!r.data || !r.data.jobId) throw { code: 'unavailable' };
          return pollDns(r.data.jobId, 30);
        }
        if (!r.ok) throw { code: 'error' };
        return r.data;
      }).then(function (res) {
        renderDns(res); setMsg(msg, t('checked') + ' ' + domain, 'ok');
      }).catch(function (err) {
        var c = err && err.code;
        setMsg(msg, c === 'unavailable' ? t('dnsUnavailable') : c === 'timeout' ? t('dnsTimeout') : t('failed'), 'err');
      }).then(function () { busy = false; $('dnsBtn').disabled = false; });
    });
  }

  /* ================= Araçlar: Cloudflare 1-Tık ================= */
  function bindCloudflare() {
    $('cfForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = $('cfMsg'), btn = $('cfBtn');
      if (S.demo) { setMsg(msg, t('demoOff'), 'err'); return; }
      var domain = normalizeDomain($('cfDomain').value);
      var token = $('cfToken').value.trim();
      if (!domain) { setMsg(msg, t('dnsInvalid'), 'err'); return; }
      /* Token ZORUNLU: sunucudaki test token'ına düşmek müşterinin değil
         bizim hesabımızla işlem yapmak olurdu. */
      if (token.length < 20) { setMsg(msg, t('cfToken'), 'err'); return; }
      setMsg(msg, t('sending')); btn.disabled = true;
      postJSON('/api/autofix-cloudflare', { domain: domain, token: token, fixType: $('cfFix').value }).then(function (r) {
        btn.disabled = false;
        $('cfToken').value = ''; /* token sayfada da tutulmasın */
        var d = r.data || {};
        if (r.ok && d.ok) setMsg(msg, t('cfOk')(d.fixType, d.domain), 'ok');
        else setMsg(msg, t('cfFail') + (d.error && d.error.code ? ' (' + d.error.code + ')' : ''), 'err');
      }).catch(function () { btn.disabled = false; setMsg(msg, t('cfFail'), 'err'); });
    });
  }

  /* ================= gezinti ================= */
  function bindTabs() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.tabs a'));
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) { a.setAttribute('aria-current', a.getAttribute('href') === '#' + en.target.id ? 'true' : 'false'); });
      });
    }, { rootMargin: '-140px 0px -60% 0px' });
    links.forEach(function (a) { var s = document.querySelector(a.getAttribute('href')); if (s) io.observe(s); });
  }

  function renderAll() {
    renderProfile(); renderOverview(); renderTable(); renderBilling(); renderNotifications();
    $('thisDevice').textContent = deviceLabel();
  }

  function enterApp() {
    $('gate').hidden = true; $('app').hidden = false;
    var dom = S.items.length ? S.items[0].domain : '';
    if (dom) { if (!$('dnsDomain').value) $('dnsDomain').value = dom; if (!$('cfDomain').value) $('cfDomain').value = dom; }
    renderAll();
  }

  /* ================= açılış ================= */
  function start() {
    applyLang();
    document.querySelectorAll('.lang button').forEach(function (b) {
      b.addEventListener('click', function () {
        lang = b.getAttribute('data-lang'); store.set('preferredLang', lang);
        applyLang(); if (!$('app').hidden) renderAll();
      });
    });
    bindLogin(); bindTable(); bindPassword(); bindDns(); bindCloudflare(); bindTabs();
    $('logoutBtn').addEventListener('click', function () {
      if (S.demo) { location.href = '/dashboard'; return; }
      fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
        .then(function () { location.href = '/'; }, function () { location.href = '/'; });
    });

    if (S.demo) {
      var D = demoData();
      $('demoBanner').hidden = false;
      S.me = D.me; S.sub = D.sub; S.plan = D.sub.plan; S.items = D.items; S.trend = D.trend;
      S.latestDetail = D.detail;
      enterApp(); prefetchDetails();
      return;
    }

    showGate('gateLoading');
    getJSON('/api/auth/me').then(function (r) {
      var me = r.data;
      if (!r.ok || !me || !me.available) { showGate('gateDown'); return; }
      if (!me.authenticated) { showGate('gateLogin'); return; }
      S.me = me;
      return Promise.all([
        getJSON('/api/panel/subscription').then(function (s) {
          if (s.ok && s.data && s.data.plan) { S.sub = s.data; S.plan = s.data.plan; }
          /* Plan okunamadıysa "Free" demek ödeme yapmış müşteriye yanlış bilgi olur. */
          else S.plan = 'unknown';
        }).catch(function () { S.plan = 'unknown'; }),
        loadScans(false)
      ]).then(function (res) {
        if (res[1] === false) return; /* oturum düştü: giriş kapısı gösterildi */
        enterApp();
        return loadLatestDetail().then(function () { renderOverview(); return prefetchDetails(); });
      });
    }).catch(function () { showGate('gateDown'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
