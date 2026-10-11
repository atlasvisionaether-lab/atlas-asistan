---
name: auto-remediation
description: CyberLion AI ile ücretli otomatik düzeltme - Tara/Düzelt/Tekrar Tara loop + yasal çerçeve + yedek/rollback. FAZ 2 - iyzico onayı sonrası inşa et.
allowed-tools: Read, Write, Edit, Bash
version: 1.2-faz2-birlesik
---

# Auto-Remediation — AI ile Düzelt Butonu

**FAZ 2 — şimdi kod yazma.** Bu dosya üç ayrı taslağın (hukuki derinlik +
somut API/loop detayı + yedek terminolojisi netliği) birleşimidir. Hiçbir
endpoint, fonksiyon ya da UI bu dosyadan kaynaklanmıyor. Uygulamaya
geçilmeden önce §1 bir avukata inceletilmeli.

## Amaç

Fark: herkes tarıyor, biz düzeltiyoruz. Fiyatlandırma seçenekleri (ticari
karar, netleştirilmedi): **₺299 tek seferlik** ya da **₺499/ay sınırsız
düzeltme**.

---

## 1. YASAL ÇERÇEVE — ZORUNLU

**Bu olmadan yapma = TCK m.243 (bilişim sistemine izinsiz girme).**
Müşterinin rızası varsa suç değil — ama rızanın dört şartı karşılaması
gerekir, yoksa "açık rıza var" savunması çöker:

1. **Yazılı, spesifik, önceden verilmiş rıza** — "kabul ediyorum" kutucuğu
   tek başına yetmez; metin TAM OLARAK neyin değiştirileceğini saymalı
   (örn. yalnızca HTTP güvenlik başlıkları: CSP, HSTS, X-Frame-Options;
   DNS kaydı/dosya sistemi/veritabanı/kullanıcı hesabı DEĞİŞTİRİLMEZ).
2. **Kapsam dışına çıkmama** — sistem, verilen token'ın izin verdiğinden
   fazlasını teknik olarak da yapamamalı (bkz. §3.3 en az yetki).
3. **Her an geri alınabilir rıza** — müşteri işlem sırasında durdurabilir;
   bu an token silinir, iş iptal olur.
4. **Kanıtlanabilir iz** — hangi değişikliğin ne zaman, hangi rızaya
   dayanarak yapıldığı loglanır (bkz. §4 Telegram özeti).

### legal-data.js'e eklenecek (kimlik alanı DEĞİL, yapılandırma)

Satıcı kimliği (unvan/adres/VKN/vergi dairesi/tel/mail) **değişmiyor** —
aynı şahıs işletmesi aynı hizmeti satıyor. Eklenecek olan:

```js
otoDuzeltme: {
  fiyatTekSeferlik: 299,
  fiyatAylikSinirsiz: 499,
  maxDeneme: 3,
  hedefPuan: 90,
  tokenOmrSaat: 24,
  yedekOmrGun: 7,          // backup, token'dan DAHA UZUN saklanır — iş bitse bile geri dönüş penceresi
  kapsam: ['http_guvenlik_basliklari', 'tls_yapilandirmasi']  // ASLA: dns, dosya sistemi, db, kullanici hesabi
}
```

Uzun hukuki metinler (sözleşmenin tam metni) buraya YAZILMAZ — diğer
sözleşmeler gibi kendi HTML sayfasında durur (`pages/mudahale-yetki-sozlesmesi.html`,
mevcut sayfa şablonu + SATICI BİLGİLERİ bloğu kullanılır).

### Checkout öncesi 3 ayrı checkbox (birleştirilmeden)

- [ ] Mesafeli Satış Sözleşmesi'ni okudum, onaylıyorum.
- [ ] Ön Bilgilendirme Formu'nu okudum, onaylıyorum.
- [ ] **Müdahale Yetki Sözleşmesi'ni okudum; sunucuma/hesabıma tanımlı
      kapsamla sınırlı erişim yetkisi veriyorum, yedeğimin alındığını ve
      geri yüklenebileceğini, yetkinin 24 saat içinde otomatik
      sileceğini biliyorum.**

Üçü ayrı olmalı — bir anlaşmazlıkta "hangi belgeyi onayladığı" net
cevaplanabilsin.

### Yetki metni örneği (Müdahale Yetki Sözleşmesi'nden bir madde)

> "Alıcı, Satıcı'ya ait AI sisteminin, yalnızca onay verdiği Cloudflare/
> Vercel/cPanel hesabında, sadece güvenlik başlıklarını ve TLS
> yapılandırmasını düzeltmek amacıyla geçici erişim yetkisi verdiğini
> beyan eder. Yetki, işlem bitiminde veya en geç 24 saat sonra otomatik
> olarak silinir. Düzeltme öncesi mevcut yapılandırmanın yedeği alınır
> ve 7 gün süreyle saklanır; Alıcı bu süre içinde eski hâline dönülmesini
> talep edebilir."

### Sorumluluk sınırı

Satıcı'nın sorumluluğu ödenen bedeli aşmaz; **kasıt ve ağır kusur hariç**
(TBK m.115 — ağır kusur sorumluluğu önceden kaldırılamaz, bunu es geçen
bir madde hukuken geçersiz sayılır). Düzeltme sonrası oluşabilecek
kesintilerden bu sınırlar dahilinde sorumluluk üstlenilir; yedek
kullanıcıya/geri yükleme talebine açık tutulur.

### KVKK notu

İşlenen veri esas olarak müşterinin kendi altyapı yapılandırmasıdır,
kişisel veri değildir. Asıl risk TCK m.243 ve sözleşme hukukunda; KVKK bu
akışta ikincil (bkz. token'ın kendisinin sızdırılmaması, §3.3).

---

## 2. TEKNİK MİMARİ

**Claude Code gömülmez, Claude API (Agent SDK / tool-use) gömülür.**
Claude Code interaktif bir geliştirici aracıdır, sunucusuz fonksiyona
gömülecek bir şey değil.

### 2.1 Endpoint

- **`/api/remediate.js`** (Vercel Function)
- **Input:** `{ domain, issues: ['HSTS','CSP'], provider: 'cloudflare'|'vercel'|'cpanel', token }`
- Agent'a yalnızca sağlayıcıya özel DAR araçlar verilir (`cloudflare_set_header_rule`
  gibi) — agent asla ham shell/dosya sistemi çalıştırmaz; araç listesi
  sözleşmenin kapsam maddesiyle (§1, madde 2) birebir eşleşir.

### 2.2 Akış

1. **Ödeme** → iyzico callback → `jobId` üret.
2. **YEDEK AL (backup, şart — asla atlama):**
   - `GET /api/scan?domain=x` ile mevcut tüm security header'ları/TLS
     ayarını çek.
   - `{jobId}-yedek.json` olarak kaydet: `{ timestamp, domain, headers, rawConfig }`.
     Vercel için mevcut `vercel.json`, Cloudflare için zone settings,
     cPanel için mevcut `.htaccess` — sağlayıcıya göre ne yedekleniyorsa.
   - Telegram: `💾 YEDEK alındı {jobId} | {domain}`
   - Yedek **7 gün** saklanır (token'dan bağımsız, daha uzun — iş bitse
     bile geri dönüş penceresi kalsın diye).
3. **Fix üret:** Claude API'ye spesifik prompt — örn. "Bu domain için HSTS
   eksik, Vercel için vercel.json header config üret, sadece JSON döndür."
4. **Önizleme/onay:** Kullanıcıya "Şunu ekleyeceğim: …" gösterilir, somut
   diff ile; **Onayla** butonuna basılmadan hiçbir yazma işlemi
   yapılmaz. Bu adım hem güvenlik hem §1'deki "spesifik rıza" ilkesinin
   her bir değişiklik için somut hale gelmesidir.
5. **Uygula** (provider'a özel):
   - Cloudflare: `PUT /zones/:id/settings/security_header`
   - Vercel: `vercel.json`'daki header config'i güncelleyip repo'ya
     push (ya da Vercel API ile proje ayarı).
   - cPanel: `.htaccess`'e header enjeksiyonu.
6. **Tekrar tara:** 10 sn bekle → `scan(domain)` → puan 90+ oldu mu?
7. **Telegram özeti:** `🔧 Düzeltme {jobId} | {domain} | 65→92 puan`

### 2.3 Token saklama

- Supabase yok (kısıt) → mevcut **Upstash Redis** (`api/_lib/store.js`,
  env'ler zaten Vercel'de tanımlı).
- AES-256-GCM şifreleme, anahtar yeni bir Vercel env'i
  (`ENCRYPTION_KEY`/`REMEDIATION_TOKEN_KEY`, henüz eklenmedi).
- TTL 24 saat + iş bitince (başarı/başarısızlık/iptal) **aktif silme** —
  TTL yalnızca pasif bir güvenlik ağı, asıl mekanizma değil.
- Token asla loglanmaz (bkz. `telegram.js`'teki `gizle()` deseni).
- **En az yetki:** müşteriye hangi API izin kapsamının isteneceği
  önceden söylenir (örn. Cloudflare için yalnızca
  "Zone → SSL and Certificates: Edit"); agent'ın araç seti de bu
  kapsamla sınırlı tutulur.

### 2.4 Yedek (backup) ≠ token

İkisi karıştırılmamalı: **token** 24 saatte silinir (erişim riski),
**yedek** (eski config) 7 gün saklanır (geri dönüş imkânı). Token
silinse bile yedek üzerinden rollback, o 7 gün içinde insan desteğiyle
hâlâ yapılabilir.

---

## 3. LOOP MANTIĞI — hatalı yaparsa tekrar düzelt (algoritma, kod değil)

```js
// /api/remediate.js içinde — PSEUDOCODE, gerçek implementasyon FAZ 2'de
let attempt = 0;
let score = ilkPuan;
let lastError = null;

while (score < 90 && attempt < 3) {
  attempt++;
  const fix = await claude.generateFix(domain, issues, lastError); // Agent SDK tool-use
  await kullaniciyaOnizlemeGosterVeOnayBekle(fix);                  // §2.2 adım 4 — asla atlanmaz
  await provider.apply(fix);
  await sleep(10000);
  const rescan = await scan(domain);
  score = rescan.score;
  if (score < 90) {
    lastError = rescan.failedHeaders;   // bir sonraki denemeye bağlam olarak verilir
    await telegram(`⚠️ YEDEK duruyor, Retry ${attempt} - ${domain} hâlâ ${score}`);
  }
}

if (score < 90) {
  await rollback(jobId);   // yedeği geri yükle (§2.4)
  await telegram(`❌ 3 deneme başarısız, YEDEK geri yüklendi → insan desteği (/dashboard)`);
  durum = 'needs_human';
} else {
  await telegram(`✅ Düzeltme tamamlandı: ${domain} — puan ${ilkPuan} → ${score}`);
  durum = 'done';
}

await redis.del(token_key);          // HER durumda, koşulsuz
// yedek(backup) dosyası 7 gün daha kalır, token hemen silinir
```

**3 deneme sonrası insana düşme** = token zaten silinmiş olduğu için
insan desteği devreye girerse (ör. destek ekibi manuel bakarsa) eski
yetki tekrar kullanılamaz — yeni bir yetkilendirme turu (yeni token, yeni
onay) gerekir. Bu, §1'deki "süre sınırlı rıza" ilkesinin doğal sonucu.

---

## 4. Açık kalan kararlar (uygulamadan önce netleştirilmeli)

- İki fiyatlandırma seçeneğinden (tek seferlik ₺299 / aylık sınırsız
  ₺499) hangisi veya ikisi birden sunulacak — ticari karar.
- 3 deneme de başarısız olursa ücret iadesi politikası.
- "Puan 90+" eşiğinin tüm sağlayıcılarda aynı ölçüm mantığıyla
  karşılaştırılabilir olduğu doğrulanmalı.
- cPanel bağlayıcısının gerçekçiliği — host'a göre API erişimi çok
  değişken, MVP'den çıkarılıp yalnızca Cloudflare + Vercel ile
  başlanabilir.
- `ENCRYPTION_KEY`/`REMEDIATION_TOKEN_KEY` env'i ve bu tek seferlik/aylık
  ürünün iyzico'da nasıl ayrı faturalandırılacağı tasarlanmadı.
