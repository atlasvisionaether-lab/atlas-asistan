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
          'Aynı ekranda "Karşılama Mesajı" alanı da kaydedilir, ancak otomatik cevaplar şu an bu alanı KULLANMIYOR; selamlamayı da System Prompt belirler.',
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
          'Çalışma saatleri dışında asistan cevap üretmez; bunun yerine "Fallback / Anlamadım mesajı" gönderilir. Bu alan boşsa mesai dışında müşteriye hiç cevap gitmez, mesaj Gelen Kutusu\'nda bekler.',
          'Ekrandaki "Çalışma saatleri dışı mesajı" alanı şu an otomatik cevapta KULLANILMIYOR; mesai dışı için Fallback mesajını doldurun.',
          'Aynı ekranda "AI otomatik cevap" açılıp kapatılabilir ve anahtar kelime kuralları eklenebilir.',
          'Yüksek riskli (sağlık, şikâyet) olarak işaretlenen mesajlara asistan cevap üretmez; konuşma ekibinize (insana) bırakılır.',
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
    title: 'WhatsApp Business\'ı işletmenize bağlamak',
    steps: [
      {
        title: 'Hangi numarayı vermeliyim?',
        facts: [
          'Atlas Asistan WhatsApp Business Cloud API altyapısında çalışır; verdiğiniz numara bu altyapıya kaydedilir.',
          'Kaydedilen numara artık telefondaki WhatsApp ya da WhatsApp Business uygulamasından kullanılamaz.',
          'Tavsiye: günlük kişisel numaranızı değil, kliniğin resmi iş numarasını ya da bu iş için ayrılmış yeni bir numarayı verin.',
          'İşletme adınız, profil fotoğrafınız ve müşterilerin bildiği numara aynı kalır; müşteri tarafında bir şey değişmez.'
        ]
      },
      {
        title: 'Bağlamadan önce hazırlık',
        facts: [
          'Mevcut WhatsApp sohbet geçmişi yeni sisteme aktarılmaz; önemliyse önce telefondan yedek alın.',
          'Numaranın doğrulama kodu (SMS ya da sesli arama) alabilen bir hatta olması gerekir.',
          'Bu adım geri alınabilir: numara istenince sistemden çıkarılıp normal WhatsApp\'a döndürülebilir.'
        ]
      },
      {
        title: 'Bağlantı nasıl yapılır?',
        screen: 'onboarding',
        facts: [
          'Şu an numarayı bağlama işlemini ödemeden sonra Atlas ekibi yapar; panelde kendi kendine bağlama düğmesi henüz yoktur.',
          'Bağlantı sırasında numaranıza bir doğrulama kodu gelir; ekip sizden bu kodu ister. Kodu yalnızca Atlas ekibiyle, bağlantı sırasında paylaşın.',
          'Bağlantı tamamlanınca Kurulum ekranındaki 3. adım ("WhatsApp numaranızı bağlayın") kendiliğinden "tamam" olur ve bağlı numara orada yazar.',
          'Sadece asistan paketlerinde kurulum genellikle 1-2 iş günü sürer; süre bilgileriniz ulaştıktan sonra başlar.'
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
          'Bu adım için WhatsApp numaranızın bağlanmış olması gerekir (Kurulum ekranında 3. adım "tamam").',
          'Kendi kişisel telefonunuzdan, kliniğin bağlanan numarasına WhatsApp\'tan "Merhaba" yazın.',
          'Çalışma saatleri içindeyse ve "AI otomatik cevap" açıksa asistan birkaç saniye içinde cevap verir.',
          'Çalışma saatleri dışındaysanız asistan yerine Fallback mesajı gelir (boşsa hiç cevap gelmez). Testi mesai saatinde yapın ya da çalışma saatlerini geçici olarak genişletin.'
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
