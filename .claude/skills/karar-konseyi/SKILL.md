---
name: karar-konseyi
description: Geri dönüşü zor büyük kararları tek görüşle değil, beş zıt danışman rolüyle test eder ve sonunda başkan adımıyla tek sonuca bağlar. Teknik mimari seçimi, kütüphane/stack kararı, refactor'a girme, işe alım, bölüm/kariyer seçimi, girişim, büyük harcama gibi kararlarda kullan. Tetikleyiciler: "hangisini seçmeliyim", "bu kararı ver", "X mi Y mi", "buna değer mi", "karşı görüş ver", "beni onaylama", "konseye sor", "artılarını eksilerini tart".
---

# Karar konseyi (LLM Council mantığı)

## Neden

Bir modele "bunu yapmalı mıyım" diye sorduğunda model çoğu zaman senin fikrini
sana geri yansıtır — onay verir, karşı çıkmaz. Geri dönüşü zor kararlarda bu
risklidir. Çözüm: tek görüş yerine birbirine karşı çıkan beş görüş, sonra hepsini
tartan bir başkan adımı.

Kaynak fikir Andrej Karpathy'nin `llm-council` projesi: soru dört farklı modele
sorulur, her model diğerlerinin (kimliği gizlenmiş) cevabını puanlar, bir
"chairman" model hepsini tek cevaba indirir. Bu skill aynı mantığı tek oturumda
beş rolle çalıştırır.

## Ne zaman kullanılır

Geri dönüşü zor ve tek bakış açısının riskli olduğu kararlar:
mimari/stack seçimi, büyük refactor'a girme, satın al-vs-yaz kararı, iş veya
staj teklifi, okul/bölüm seçimi, girişim kurma, büyük yatırım, ortaklık.

**Kullanma:** günlük küçük kararlar, tek doğru cevabı olan teknik sorular,
zaten karar verilmiş ve sadece uygulanması gereken işler.

## Akış

Önce kararı ve bağlamı tek paragrafta netleştir (belirsizse kullanıcıya sor).
Sonra beş rolü **sırayla ve ayrı başlıklar altında** çalıştır. Her rol kendi
görevinde kalır; rolleri birbirine karıştırma, birbirini yumuşatma.

### Danışman 1 — Karşıt Görüşlü
Bu fikre tamamen karşı çık. Tek görevin bu kararın neden başarısız olacağını
bulmak. Yumuşatma, dengeleme yapma, en zayıf noktaları sırala.

### Danışman 2 — Prensip Üretici
İlke temelli argüman üret. Duygudan ve bu özel durumdan değil, genel geçer
prensiplerden konuş: hangi kural bu kararı destekler, hangisi çürütür.

### Danışman 3 — Fırsat Avcısı
Kaçırılan fırsatları ve görülmeyen alternatifleri ortaya çıkar. Fırsat
maliyetini adlandır: bu kararı alırsak neyi yapamayacağız?

### Danışman 4 — Dışarıdan Bakan
Kullanıcıyı hiç tanımayan, duygusal yatırımı olmayan biri gibi değerlendir.
Sadece ortaya konan bilgiyle konuş, iyi niyet varsayma.

### Danışman 5 — Uygulamacı
Kararı sonuçlandır: somut aksiyon planı. İlk 3 adım ne, hangi sırayla, her
adımın doğrulaması ne?

### Başkan adımı (atlanmaz)
Beş görüşü aldıktan sonra hepsini birlikte tart:

- Hangi argüman gerçekten güçlü, hangisi sadece yüksek sesli?
- Danışmanlar nerede çelişiyor ve bu çelişki neyi ortaya çıkarıyor?
- Kararı değiştirecek tek bilgi ne olurdu? (elde yoksa bunu söyle)
- Net öneri + gerekçesi, 3-5 cümle.

## Kurallar

- Beş rolün hepsi çalışmadan başkan adımına geçme.
- Karşıt Görüşlü rolünü yumuşatma; işi zaten karşı çıkmak.
- Bilgi eksikse uydurma — "bu karar şu bilgi olmadan verilemez" demek geçerli
  bir çıktıdır.
- Konsey kararı vermez, kararı test eder. Son söz kullanıcınındır; bunu çıktının
  sonunda açıkça belirt.

## Gerçek çok-modelli kurulum (opsiyonel)

Tek model yerine gerçekten farklı modellerle çalışmak isteniyorsa:
`github.com/karpathy/llm-council` — backend Python (FastAPI, `uv sync`),
frontend React + Vite (`npm install`), modeller OpenRouter üzerinden tek API
anahtarıyla (`.env` içinde `OPENROUTER_API_KEY`). Konsey üyeleri ve chairman
modeli `backend/config.py` içinde tanımlı. Karpathy projeyi kişisel kullanım
için yazdığını ve resmi destek vermeyeceğini belirtiyor — kurumsal bir ürün
değil.

---

Kaynak: "LLM Council · Kurulum ve Danışman Konseyi Kiti v1" — @burhankocabiyik;
temel proje: Andrej Karpathy, `llm-council`.
