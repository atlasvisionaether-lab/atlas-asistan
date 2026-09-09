---
name: uygulama-buyume-sistemi
description: Bir uygulamayı sıfırdan üretime hazır çıkarma, n8n ile otomasyona bağlama ve reklamsız organik içerikle büyütme sistemini üç aşamalı olarak yürütür. Tetikleyiciler: "uygulama kur", "SaaS yapalım", "MVP çıkar", "üretime hazır olsun", "n8n workflow", "otomasyon kur", "webhook akışı", "organik büyüme", "reklamsız kullanıcı", "nasıl duyururum".
---

# Uygulama + otomasyon + organik büyüme

Üç aşama üst üste oturur. **Sırayı bozma:** uygulama → otomasyon → dağıtım.
Bir aşama doğrulanmadan sonrakine geçme.

## Aşama 1 — Üretime hazır uygulama

Hedef "demo" değil, ilk gerçek kullanıcıda kırılmayan uygulama.

**Teknik gereksinimler**
- Temiz, mobil uyumlu arayüz, tutarlı tasarım dili
  (görsel taraf için `profesyonel-web-sitesi` skill'ini de yükle).
- Her form ve API uç noktasında girdi doğrulama.
- Tüm hatalar yakalanır; sessiz hata yok.
- Tip güvenli veri katmanı; sihirli değer yok.
- Gizli anahtarlar `.env`'de, kodda değil.

**Bitiş şartı — kritik**

"Çalışıyor" demek yasak. Her özelliği canlı çalıştır ve kanıtla:
- Örnek istek + gerçek yanıtı göster.
- Geçersiz girdiyi de dene, dönen hata mesajını göster.

Sadece "yap" dersen demo çıkar; "canlı çalıştır ve kanıtla" dersen test edilmiş
uygulama çıkar. Fark bu şartta.

**Sıra**
1. Uygulamayı tek cümleyle tanımla: ne yapıyor, kim kullanıyor, temel özellik ne.
2. Arayüzü sabitle — ilk ekranda renk, font, bileşen stili belirlensin; sonraki
   her ekran bu temele otursun.
3. Her uç noktayı geçerli + geçersiz girdiyle test et.

## Aşama 2 — n8n otomasyonu

Uygulama n8n'e bağlanınca sistem kendi başına dönmeye başlar.

**Temel akış iskeleti**
```
1. TRIGGER      HTTP Webhook (uygulama tetikler) veya zamanlayıcı
2. API ÇAĞRISI  GET/POST → uygulamanın uç noktası
                Auth: Bearer token, .env'den — asla workflow içine gömme
3. VERİ İŞLE    JSON parse → filtrele → zenginleştir
                Hata varsa: log'a yaz + bildirim gönder
4. ÇIKTI        İçerik üretimi için hazır formatta kaydet
                (Google Sheets / Airtable / Webhook)
```

**Kural:** önce tek bir workflow'u sonuna kadar kur ve çalıştır. Her adım
doğrulandıktan sonra ikinci workflow'a geç. Paralel başlamak hata ayıklamayı
zorlaştırır.

Bu aşamaya geçmeden Aşama 1'in API uç noktalarını ve auth şeklini belgele —
n8n'in bağlanabilmesi için gerekli.

## Aşama 3 — Organik dağıtım

Reklam kitleyi satın alır; organik içerik güven inşa eder. Kullanıcılar bir aracı
denemeden önce üreticisine güvenip güvenmediğine bakar.

1. **Nişe odaklan.** Geniş kitle değil, spesifik bir grup. Kaynak vaka
   çalışmasında bu grup "YouTube kanallarını n8n/Make ile otomatize eden içerik
   üreticileri" idi — kendi ürünün için karşılığını sen tanımla: kim bu
   uygulamayı en çok kullanır?
2. **Değer odaklı içerik üret.** Tanıtım değil sonuç: "şunu şöyle yaptım, işe
   yaradı" formatı. Uygulamanın çözdüğü somut sorunu göster.
3. **Süreklilik kur.** Haftada en az 3 içerik. Tek viral parça değil, düzenli
   yayın kitleyi biriktirir.

## Başlangıç checklist'i

1. Uygulamayı tanımla ve kur — her uç nokta test edilene kadar bitmiş sayma.
2. API uç noktalarını ve auth'u belgele.
3. İlk n8n workflow'unu kur, çalıştığını doğrula, sonra genişlet.
4. Hedef nişi belirle.
5. İlk 5 içeriği üret; haftada 3 yayın hedefle.
6. Döngüyü kur ve içerik üretimine odaklan.

## Dürüstlük notu

Kaynak doküman "56 saatte 105.000 dolar, sıfır reklam bütçesi" diyor. Bu tek bir
kişinin doğrulanmamış beyanıdır — yöntem faydalı, rakam garanti değil. Bu sayıyı
kullanıcıya beklenen sonuç gibi sunma.

---

Kaynak: "Uygulama & Organik Büyüme Rehberi v1" — @burhankocabiyik.
