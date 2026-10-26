'use strict';

/**
 * Klinik sahibi rehberi (panel #rehber) — konular ve adımlar.
 *
 * TEK DOĞRULUK KAYNAĞI: DeepSeek bir adımı anlatırken YALNIZCA o adımın
 * `facts` listesini kullanır (bkz. api/atlas-guide.js sistem metni). Model
 * burada yazmayan bir düğme, ekran ya da özellik uyduramaz; ürün değişince
 * önce burası güncellenir.
 *
 * `screen`: adımın panelde açılacağı ekran (#hash). Panel "Şimdi aç" der.
 * Gerçekte olmayan şey "henüz yok" diye yazılır (ör. Google Takvim senkronu).
 */

const TOPICS = [
  {
    id: 'kurulum',
    title: 'Panelinizi tanıyın ve ilk kurulum',
    steps: [
      {
        title: 'Kurulum ekranı ne işe yarar?',
        screen: 'onboarding',
        facts: [
          'Panelin solundaki menüde en üstte "Kurulum" ekranı var.',
          'Kurulum dört adımdan oluşur: 1) hizmet ve fiyatları eklemek, 2) paket seçip ödemek, 3) WhatsApp numarasının bağlanması, 4) ilk test mesajı.',
          'Adımlar kendiliğinden işaretlenir: örneğin ilk hizmeti ekleyince 1. adım "tamam" olur. Elle işaretlenecek bir düğme yoktur.',
          'Ekranın üstündeki çubuk kaç adımın bittiğini gösterir.'
        ]
      },
      {
        title: 'Karşılama mesajı ve asistanın tonu',
        screen: 'ai',
        facts: [
          'Menüde "AI Asistan Ayarları" ekranında "System Prompt" (asistanın talimat metni) alanı vardır; asistanın üslubunu ve neye cevap verip vermeyeceğini bu metin belirler.',
          'Aynı ekranda "Karşılama Mesajı" alanı vardır: yeni bir müşteri ilk kez yazdığında bu mesaj BİR KEZ gönderilir. Müşteri bir soru da sorduysa asistan karşılamanın ardından sorusunu cevaplar.',
          'Karşılama mesajını boş bırakırsanız karşılama gönderilmez; asistan doğrudan cevap verir.',
          '"Fallback" mesajı, asistanın cevap üretemediği durumlarda ve çalışma saatleri dışında gönderilen hazır mesajdır.',
          'Değişiklikler "Kaydet" ile kaydedilir.'
        ]
      },
      {
        title: 'Çalışma saatleri ve mesai dışı mesajı',
        screen: 'automations',
        facts: [
          'Menüde "Otomasyonlar" ekranında "Genel & Çalışma Saatleri" bölümü vardır.',
          '"Çalışma saatleri (içinde AI cevap verir)" alanı asistanın hangi saatlerde (Türkiye saatiyle) otomatik cevap vereceğini belirler.',
          'Çalışma saatleri dışında asistan cevap üretmez; bunun yerine "Çalışma saatleri dışı mesajı" gönderilir.',
          '"Çalışma saatleri dışı mesajı" boşsa "Fallback / Anlamadım mesajı" gönderilir; ikisi de boşsa mesai dışında müşteriye cevap gitmez, mesaj Gelen Kutusu\'nda bekler.',
          'Aynı ekranda "AI otomatik cevap" açılıp kapatılabilir ve anahtar kelime kuralları eklenebilir.',
          'Yüksek riskli (sağlık, şikâyet) olarak işaretlenen mesajlara asistan cevap üretmez; yalnızca "ekibimiz size dönecek" notu gönderir ve konuşma ekibinize (insana) bırakılır.',
          'Bir müşteri insan temsilciye aktarıldıysa asistan o müşteriye artık otomatik cevap vermez.'
        ]
      },
      {
        title: 'Paket seçimi ve ödeme',
        screen: 'odeme',
        facts: [
          'Ödeme panelin içinden yapılır: Kurulum ekranındaki "Paket seç ve öde" düğmesi "Paket / Ödeme" ekranını açar.',
          'Paketler: Standart Asistan 4.900 TL/ay, Pro Asistan 7.900 TL/ay, Dijital Başlangıç 14.900 TL tek sefer + 1.200 TL/ay, VIP Klinik Dönüşümü 24.900 TL tek sefer + 2.400 TL/ay. Hepsi KDV dahil.',
          'Fatura için bireyselde TC Kimlik No, kurumsalda Vergi No ve vergi dairesi istenir.',
          'Kart bilgileri Atlas\'a değil, doğrudan iyzico\'nun güvenli ödeme sayfasına girilir.',
          'Ödemeden sonra panelin Kurulum ekranına dönülür; sonuç orada yazar. Ödemeleri yalnızca klinik sahibi ya da yönetici yapabilir.'
        ]
      }
    ]
  },
  {
    id: 'whatsapp',
    title: 'Mesaj kanallarınızı bağlamak (WhatsApp, Instagram, Telegram)',
    steps: [
      {
        title: 'Hangi kanal, hangi numara?',
        screen: 'kanallar',
        facts: [
          'Kanallar ekranından WhatsApp, Instagram ve Telegram\'ı kendiniz bağlarsınız; Atlas ekibinin bir şey yapmasını beklemeniz gerekmez.',
          'En hızlısı Telegram: yaklaşık 2 dakika. WhatsApp ve Instagram için bir Meta uygulaması gerekir.',
          'WhatsApp, Meta\'nın WhatsApp Cloud API altyapısıyla çalışır. Bağlanan numara artık telefondaki WhatsApp ya da WhatsApp Business uygulamasından kullanılamaz.',
          'Tavsiye: günlük kişisel numaranızı değil, kliniğin resmi iş numarasını ya da bu iş için ayrılmış yeni bir numarayı kullanın. Mevcut sohbet geçmişi taşınmaz; önce yedek alın.'
        ]
      },
      {
        title: 'Telegram\'ı bağlamak',
        screen: 'kanallar',
        facts: [
          'Telegram\'da @BotFather\'ı açıp /newbot yazarsınız; bota bir ad ve sonu "bot" ile biten bir kullanıcı adı verirsiniz.',
          'BotFather size uzun bir token verir. Kanallar ekranındaki Telegram kartına yapıştırıp Bağla\'ya basarsınız.',
          'Bağlanınca kart "Bağlı" olur. Botunuza Telegram\'dan "Merhaba" yazarak deneyebilirsiniz.'
        ]
      },
      {
        title: 'WhatsApp\'ı bağlamak',
        screen: 'kanallar',
        facts: [
          'Meta geliştirici sitesinde (developers.facebook.com) bir İşletme uygulaması oluşturup WhatsApp ürününü eklersiniz.',
          'Kanallar ekranına dört değer girilir: Phone number ID, WhatsApp Business Account ID, kalıcı (Sistem Kullanıcısı) erişim jetonu ve uygulamanın App Secret\'ı. Her birinin nereden alındığı kartta adım adım yazar.',
          'Bağla\'ya basınca kart "Son adım bekleniyor" olur ve size bir Webhook adresi ile doğrulama jetonu verir.',
          'Bu iki değeri Meta uygulamanızda WhatsApp → Yapılandırma → Webhook bölümüne girer ve "messages" alanına abone olursunuz. Meta adresi doğrulayınca kart "Bağlı" olur ve Kurulum\'daki kanal adımı kendiliğinden tamamlanır.',
          'Erişim jetonu ve App Secret şifreli saklanır; panelde bir daha gösterilmez.'
        ]
      },
      {
        title: 'Instagram\'ı bağlamak',
        screen: 'kanallar',
        facts: [
          'Instagram hesabınızın İşletme hesabı olması ve bir Facebook Sayfasına bağlı olması gerekir.',
          'Instagram ayarlarında Mesajlar bölümünde "Mesajlara erişime izin ver" açık olmalıdır.',
          'Kanallar ekranına iki değer girilir: Facebook Sayfasının uzun ömürlü erişim jetonu ve Meta uygulamanızın App Secret\'ı.',
          'WhatsApp\'ta olduğu gibi size verilen Webhook adresini ve doğrulama jetonunu uygulamanızın Instagram webhook ayarına girip "messages" alanına abone olursunuz.'
        ]
      },
      {
        title: 'Bağlantıyı kesmek ve süre',
        screen: 'kanallar',
        facts: [
          'Kanallar ekranındaki "Bağlantıyı kes" ile bir kanalı istediğiniz zaman kapatabilirsiniz; asistan o kanaldan cevap vermeyi bırakır.',
          'Kanalları yalnız klinik sahibi ya da yöneticisi bağlayıp kesebilir; diğer ekip üyeleri durumu görür.',
          'Tüm paketlerde bilgileriniz tamamlandıktan sonra 24 saat içinde yayındasınız. Takılırsanız merhaba@atlasasistan.com adresinden ekibimiz yardım eder.'
        ]
      }
    ]
  },
  {
    id: 'hizmetler',
    title: 'Asistanınıza hizmet ve fiyatlarınızı tanıtmak',
    steps: [
      {
        title: 'Hizmet eklemek',
        screen: 'services',
        facts: [
          'Menüde "Hizmetler / Fiyatlar" ekranında "+ Yeni hizmet ekle" düğmesi vardır.',
          'Her hizmetin adı ve fiyatı yazılır; "Kaydet" ile kaydedilir.',
          'Asistan müşterilere YALNIZCA bu listedeki hizmet ve fiyatları söyler; listede olmayan fiyatı uydurmaz.',
          'Değişiklik anında geçerli olur; ayrıca bir şey yapmanız gerekmez.'
        ]
      },
      {
        title: 'Hizmeti düzenlemek ya da geçici kapatmak',
        screen: 'services',
        facts: [
          'Her hizmetin yanında "Düzenle" ve "Sil" düğmeleri vardır.',
          'Hizmetin yanındaki anahtar ile hizmet pasifleştirilebilir; pasif hizmet silinmez ama asistan onu müşterilere önermez.'
        ]
      },
      {
        title: 'Belgelerden bilgi eklemek (Bilgi Bankası)',
        screen: 'knowledge',
        facts: [
          'Menüde "Bilgi Bankası" ekranından fiyat listesi, broşür, iptal politikası gibi belgeler yüklenebilir (PDF veya Word, en çok 10 MB).',
          'Belge metne çevrilir; çıkan metni kontrol edip onaylarsınız. Asistan yalnızca ONAYLADIĞINIZ belgelerdeki bilgileri kullanır.',
          'Sağlık ve şikâyet mesajlarında belgeler kullanılmaz; o mesajlar ekibinize devredilir.'
        ]
      }
    ]
  },
  {
    id: 'test',
    title: 'İlk test mesajını göndermek',
    steps: [
      {
        title: 'Test mesajı gönderin',
        facts: [
          'Bu adım için en az bir kanalın bağlı olması gerekir (Kurulum ekranında 3. adım "tamam").',
          'Kendi kişisel telefonunuzdan bağladığınız kanala "Merhaba" yazın: WhatsApp numaranıza, Instagram hesabınıza ya da Telegram botunuza.',
          'Çalışma saatleri içindeyse ve "AI otomatik cevap" açıksa önce Karşılama Mesajınız gelir (yeni müşteriye bir kez). Yalnızca "Merhaba" yazdıysanız cevap bu kadardır; soru sorduysanız asistan ardından sorunuzu cevaplar.',
          'Çalışma saatleri dışındaysanız "Çalışma saatleri dışı mesajı" gelir. Asistanın cevabını denemek için testi mesai saatinde yapın ya da çalışma saatlerini geçici olarak genişletin.'
        ]
      },
      {
        title: 'Gelen Kutusu\'nda kontrol edin',
        screen: 'inbox',
        facts: [
          'Menüde "Gelen Kutusu" ekranında mesajınız ve asistanın cevabı görünür.',
          'İlk mesaj geldiğinde Kurulum ekranındaki 4. adım kendiliğinden "tamam" olur.',
          'Gelen Kutusu\'ndan müşteriye siz de elle cevap yazabilirsiniz.'
        ]
      },
      {
        title: 'Fiyat ve devralma denemesi',
        facts: [
          'Bir hizmetinizin fiyatını sorun (ör. "Lazer epilasyon ne kadar?"); asistan Hizmetler listesindeki fiyatı söylemeli.',
          'Listede olmayan bir hizmeti sorarsanız asistan fiyat uydurmamalı; bilmediğini söyleyip ekibe yönlendirmeli. Yanlış bir fiyat söylerse hizmeti Hizmetler listesine ekleyin ya da düzeltin.',
          'Yüksek riskli (sağlık, şikâyet) olarak işaretlenen mesajlara asistan cevap vermez; o konuşmayı ekibiniz Gelen Kutusu\'ndan devralır.'
        ]
      }
    ]
  },
  {
    id: 'takvim',
    title: 'Randevu takvimi',
    steps: [
      {
        title: 'Randevular nerede görünür?',
        screen: 'appointments',
        facts: [
          'Menüde "Randevular" ekranı günlük takvimi gösterir; günler arasında ileri-geri gidilebilir.',
          '"Yeni Randevu" ile elle randevu eklenebilir; randevuların durumu (onay, iptal) buradan değiştirilir.'
        ]
      },
      {
        title: 'Google Takvim / dış takvim senkronu',
        screen: 'appointments',
        facts: [
          'Google Takvim, Outlook ya da başka bir dış takvimle otomatik senkron şu an YOKTUR.',
          'Randevular yalnızca paneldeki "Randevular" ekranında tutulur.',
          'Dış takvim senkronu istenirse Atlas ekibine iletilebilir (merhaba@atlasasistan.com).'
        ]
      }
    ]
  }
];

function topicOf(id) {
  for (let i = 0; i < TOPICS.length; i += 1) if (TOPICS[i].id === id) return TOPICS[i];
  return null;
}

/** İstemciye giden özet: adım başlıkları ve ekranlar (facts dahil — LLM yoksa panel bunları gösterir). */
function outline() {
  return TOPICS.map(function (t) {
    return { id: t.id, title: t.title, steps: t.steps.map(function (s) { return { title: s.title, screen: s.screen || null, facts: s.facts }; }) };
  });
}

module.exports = { TOPICS, topicOf, outline };
