# iyzico canlı test ödemesi — kontrol listesi

**Ne zaman:** iyzico, 3D Secure'un **tüm tutarlarda** açıldığını yazılı olarak
bildirdiğinde. Önceki iki canlı deneme `10012` ile reddedildi; muhtemel sebep
3D'nin yalnızca 3.000 TL üstünde açık olmasıydı ve bankaların 3D'siz işlemi
reddetmesi (bkz. `api/_lib/iyzico.js`, 2026-10-22 notu).

**Ne:** **Pro Aylık ₺249** (KDV dahil), işletmecinin kendi kartıyla, gerçek
abonelik. 250 TL'lik ayrı bir ürün yok; test, müşterinin göreceği akışın
aynısıdır.

**Kart bilgisi hiçbir yere yazılmaz** (bu belge, Telegram, ekran görüntüsü).
Hata durumunda yalnızca iyzico'nun `errorCode` / `errorMessage` değerleri not
alınır.

---

## 0. Ödemeden önce (kart gerekmez)

- [ ] `GET https://www.cyberlionai.com/api/checkout?mode` →
      `enabled: true`, `testMode: false`, `plans` içinde `pro_monthly`.
      *(2026-10-25 ölçümü: dördü de tanımlı, canlı.)*
- [ ] GitHub Actions → **Ödeme akışı doğrulaması (kart gerekmez)**
      (`iyzico-verify.yml`) → `base: https://www.cyberlionai.com` → yeşil.
- [ ] iyzico panelinde **Pro aylık fiyat planı 249,00 TL** — sitede yazan ve
      karttan çekilecek tutarla aynı (fiyatlar KDV dahil; bkz.
      `api/_lib/plans.js`). Farklıysa **durun**: mesafeli satış gereği tahsil
      edilen tutar sayfadakiyle aynı olmalı.
- [ ] iyzico panelinde webhook adresi:
      `https://www.cyberlionai.com/api/webhooks/iyzico`.
- [ ] Kartta **internet alışverişi açık** ve 3D SMS'i alınabilir durumda.
- [ ] Telegram öncelikli kanal açık (her adım oraya düşer).
- [ ] Test için kullanılacak Cyber Lion hesabı belli (kendi e-postanız).
      Hesap Pro olacak; daha sonra iptal edilecek.

## 1. Ödeme

- [ ] Hesapla giriş yapın → `/pricing` → iki onay kutusu → **Pro, Aylık**.
- [ ] Tarayıcı iyzico'nun barındırılan formuna gider (adres `iyzipay.com`).
- [ ] Kartı girin. **3D SMS ekranı gelmeli.** Gelmiyorsa 3D hâlâ tüm tutarlarda
      açık değil: ödemeyi tamamlamayın, iyzico'ya bildirin.
- [ ] SMS kodunu girin.

## 2. Dönüş ve doğrulama

- [ ] Tarayıcı `/panel?checkout=success` adresine döner. (`pending` da olabilir;
      birkaç dakika sonra panel yenilenir.)
      - Hata sayfası ve `10012` → hâlâ banka reddi; `errorCode`'u not edin.
- [ ] **Panel → Abonelik:** plan **Pro**, durum aktif, **"Test modu" rozeti YOK**.
- [ ] **Telegram:** "ödeme başarılı" mesajı **bir kez** (sayfa yenilenince
      tekrar düşmemeli).
- [ ] **Supabase → `cl_subscriptions`** satırı: `plan='pro'`, `active=true`,
      `status='ACTIVE'`, `iyzico_env='production'`, `iyzico_subscription_ref`
      dolu.
- [ ] **iyzico paneli:** işlem **249,00 TL**, abonelik **ACTIVE**.
- [ ] Pro hakları görünüyor (ör. panelde günlük izleme bölümü açık).

## 3. Temizlik — ATLAMAYIN

Kodda **self-servis iptal ve iade yok** (`docs/iyzico-sandbox.md` §5). Bu adımlar
yapılmazsa abonelik gelecek ay **yeniden ₺249 çeker**.

- [ ] **iyzico panelinden aboneliği iptal edin.**
- [ ] **iyzico panelinden işlemi iade edin.** Kart hesabına yansıması birkaç iş
      günü sürebilir.
- [ ] Webhook iptali işledi mi: `cl_subscriptions.status` güncellendi mi?
      Güncellenmediyse not alın (webhook imza/olay eşlemesi hatası olabilir;
      kod tarafında bakılacak).
- [ ] İptalden sonra panelde planın ne gösterdiğini not alın (dönem sonuna
      kadar Pro mu, hemen Ücretsiz mi). Bu davranış henüz canlıda
      gözlemlenmedi.
- [ ] Muhasebe: gerçek bir satış ve iadesi oluştu; fatura / iade faturası
      gerekip gerekmediğini mali müşavire sorun.

## 4. Sonuç kaydı

Testten sonra şunları not edin (kart bilgisi olmadan):

| | |
|---|---|
| Tarih/saat | |
| 3D SMS geldi mi | |
| Dönüş adresi (`success` / `pending` / hata) | |
| `errorCode` (varsa) | |
| `cl_subscriptions` satırı doğru mu | |
| Webhook iptali işledi mi | |
| İptal sonrası plan davranışı | |
| İade tamamlandı mı | |
