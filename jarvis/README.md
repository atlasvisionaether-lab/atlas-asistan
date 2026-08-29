# Atlas — Ubuntu için yerel Türkçe sesli asistan

Ollama üzerinde **tamamen kendi bilgisayarınızda** çalışan, Türkçe konuşan bir asistan.
İnternet bağlantısı yalnızca ilk kurulumda (model indirmek için) gerekir; sonrasında
her şey çevrimdışı çalışır. API anahtarı ya da abonelik gerekmez.

| Bileşen | Kullanılan araç |
|---|---|
| Dil modeli | Ollama (`qwen2.5` — Türkçesi güçlü) |
| Konuşma → metin | faster-whisper (Türkçe) |
| Metin → konuşma | Piper (`tr_TR-dfki-medium`), yedek: espeak-ng |

---

## 1. Kurulum (tek komut)

Ubuntu terminalinde (Ctrl+Alt+T):

```bash
sudo apt update && sudo apt install -y git curl
git clone https://github.com/atlasvisionaether-lab/atlas-asistan.git
cd atlas-asistan/jarvis
bash install.sh
```

Kurulum betiği sırasıyla şunları yapar:

1. Gerekli sistem paketlerini kurar (Python, ffmpeg, portaudio, espeak-ng…)
2. Ollama'yı kurar ve systemd servisi olarak başlatır
3. RAM'inize uygun modeli indirir (16 GB+ → `qwen2.5:7b`, 8 GB → `qwen2.5:3b`, altı → `qwen2.5:1.5b`)
4. Python sanal ortamını (`.venv`) hazırlar
5. Türkçe Piper sesini indirir
6. `.env` dosyasını ve `jarvis` kısayolunu oluşturur

Farklı bir model istiyorsanız:

```bash
JARVIS_MODEL=llama3.1:8b bash install.sh
```

> İlk kurulum, model indirme dahil internet hızınıza göre 5–20 dakika sürebilir.

---

## 2. Kullanım

### Pencere uygulaması (önerilen)

Kurulumdan sonra Jarvis, Ubuntu uygulama menüsüne eklenir: **Etkinlikler → "Jarvis"** yazıp
tıklayın. Terminalden açmak isterseniz:

```bash
./jarvis-gui
```

Pencerede yazarak sohbet edebilir, **Konuş** düğmesiyle mikrofondan konuşabilir,
**Sesli yanıt** kutusundan seslendirmeyi açıp kapatabilirsiniz.

### Terminal

```bash
./jarvis                       # yazılı sohbet
./jarvis --voice               # sesli sohbet (Enter'a basıp konuşun)
./jarvis -p "Bugün ne yapmalıyım?"   # tek soru sor, çık
./jarvis --voice --no-tts      # sesle sor, yazıyla cevap al
./jarvis --model llama3.1:8b   # o oturum için farklı model
```

Sohbetten çıkmak için `cık` yazın ya da Ctrl+C.

`jarvis` komutunu her dizinden çalıştırmak için (kurulum `~/.local/bin/jarvis`
kısayolunu oluşturur):

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc
jarvis
```

### Sürekli dinleme (uyandırma sözcüğü)

Pencerede **Surekli dinle** düğmesine basın. Artık düğmeye basmanıza gerek yok: **"Atlas"**
diye seslenip talimatınızı söylemeniz yeterli.

```
"Atlas, saat kaç?"          -> hemen cevaplar
"Atlas"                     -> "Efendim?" der ve talimatınızı bekler
"Merhaba Atlas, hava nasıl" -> uyandırma sözcüğü ilk üç kelime içinde de olabilir
"Bugün hava güzel"          -> yok sayılır, uyandırma sözcüğü geçmiyor
```

### Karşılıklı konuşma

Sürekli dinleme açıkken sohbet doğal akar:

- **Araya girebilirsiniz.** Atlas konuşurken siz konuşmaya başlayınca susar ve sizi dinler.
- **Her seferinde "Atlas" demeniz gerekmez.** Cevaptan sonra 6 saniye boyunca doğrudan
  devam edebilirsiniz; sessiz kalırsanız yeniden uyandırma sözcüğünü bekler.

Hoparlörünüz yüksek sesteyse Atlas kendi sesini sizin sesiniz sanıp kendini kesebilir. O
zaman `.env` içindeki `JARVIS_BARGE_FACTOR` değerini yükseltin (ör. `6.0`) ya da kulaklık
kullanın. Araya girmeyi tamamen kapatmak için `JARVIS_BARGE=0`.

Uyandırma sözcüğünü değiştirmek için `.env` içindeki `JARVIS_WAKE_WORDS` satırını düzenleyin
(virgülle birden fazla yazabilirsiniz). Asistanın adı `JARVIS_NAME` ile değişir.

Terminalde aynı mod:

```bash
./jarvis --wake
```

Mikrofon sürekli açık olur, ama **ses bilgisayardan dışarı çıkmaz** — konuşma çözümlemesi
de yerelde yapılır. Yalnızca uyandırma sözcüğüyle başlayan cümleler modele gönderilir.

### Düğmeyle konuşma

Sürekli dinlemeyi istemiyorsanız: **Konuş** düğmesine bir kez basarsınız (basılı tutmak yok). Düğme kırmızı
**Bitir**'e döner ve durum satırında ses seviyesi çubuğu görünür. Konuşmanız bitince
iki şeyden biri olur:

- Jarvis ~1,2 saniye sessizlik algılar ve kaydı kendisi bitirir, ya da
- **Bitir**'e basarsınız ve kayıt o anda durur.

Sessizlik eşiği her kayıtta ortama göre yeniden hesaplanır: ilk yarım saniyede odanın
gürültü seviyesi ölçülür, eşik onun katı olarak belirlenir. Böylece gürültülü bir odada
"konuşma bitti" anı kaçmaz. Yine de sürekli gürültüde Jarvis erken kesiyorsa ya da hiç
durmuyorsa `.env` içindeki `MIC_NOISE_FACTOR` değeriyle oynayın.

Terminal (`--voice`) modunda Enter'a basıp konuşursunuz; orada bitirme düğmesi yoktur,
sessizlik algılaması ve 20 saniyelik üst sınır geçerlidir.

---

## 3. Neler yapabilir

Atlas sadece sohbet etmez; aşağıdaki işleri **gerçekten** yapar. Uydurmaz, ilgili aracı
çağırır ve sonucu size anlatır. Sesli de çalışır: "Atlas, saat kaç?" deyip cevabı duyabilirsiniz.

| İstek | Ne olur |
|---|---|
| "Saat kaç?" / "Bugün günlerden ne?" | Sistem saatini ve tarihi söyler |
| "1250'nin yüzde 18'i kaç?" | Hesaplar (güvenli matematik ayrıştırıcı, kod çalıştırmaz) |
| "Bilgisayarın durumu nasıl?" | Bellek, disk, çalışma süresi, pil durumu |
| "Şunu not al: süt almayı unutma" | Notu kalıcı olarak kaydeder |
| "Notlarım neydi?" | Kayıtlı notları listeler |
| "20 dakika sonra bana hatırlat" | Masaüstü bildirimi kurar |
| "Tarayıcıyı aç" | Uygulamayı başlatır |
| "Bugün İstanbul'da hava nasıl?" | İnternette arar (aşağıya bakın) |

Notlar `~/.local/share/atlas/notlar.json` dosyasında tutulur.

**Güvenlik:** `uygulama_ac` yalnızca sabit bir listedeki uygulamaları açar — model
rastgele komut çalıştıramaz. `hesapla` ifadeyi kendi ayrıştırıcısıyla çözer, kod
yorumlayıcısı kullanmaz.

Yeni yetenek eklemek için `jarvis_tools.py` dosyasına `@arac(...)` ile işaretlenmiş bir
fonksiyon yazmanız yeterli; Atlas onu otomatik olarak tanır.

---

## 4. İnternet araması

Jarvis, cevabı için güncel bilgi gerektiğine **kendi karar verdiğinde** DuckDuckGo'da arama
yapar; sıradan sohbette, çeviride, kod sorularında internete hiç dokunmaz. Arama yaptığında
bunu pencerede `[ internette araniyor: ... ]` satırıyla gösterir ve cevabında kaynağı belirtir.

Kapatmak için pencerenin altındaki **Internet** kutucuğunu boşaltın, ya da:

```bash
./jarvis --no-web          # o oturum için
```

Kalıcı kapatmak için `.env` içinde `JARVIS_WEB=0` yapın.

**Gizlilik notu:** Bu özellik açıkken sohbetiniz hâlâ bilgisayarınızda kalır — dışarı çıkan
tek şey, modelin ürettiği arama sorgusudur (örneğin "Ankara hava durumu"). Sohbetin tamamı
ya da kişisel verileriniz gönderilmez. Tamamen çevrimdışı kalmak isterseniz kapatın.

Model araç kullanımını desteklemiyorsa (eski ya da küçük modeller) Jarvis bunu fark edip
aramasız devam eder, hata vermez.

---

## 5. Model değiştirme

Cevap kalitesi doğrudan modele bağlıdır. Donanımınızı ölçüp uygun modeli kuran araç:

```bash
bash switch-model.sh
```

Ekran kartınızın belleğini okur, listeden önerilen modeli işaretler, seçtiğinizi indirip
`.env` dosyasını günceller. Doğrudan da verebilirsiniz:

```bash
bash switch-model.sh qwen3:8b
```

| Model | Yaklaşık boyut | Not |
|---|---|---|
| `qwen3:8b` | ~5 GB | Güçlü muhakeme, iyi Türkçe. 8 GB VRAM için ideal |
| `qwen3:14b` | ~9 GB | Daha isabetli. 12 GB+ VRAM ister |
| `gemma3:12b` | ~8 GB | Çok dilli yanı güçlü |
| `qwen2.5:7b` | ~5 GB | Hızlı, muhakemesi zayıf |
| `qwen3:30b-a3b` | ~18 GB | Çok güçlü; 20 GB+ VRAM ya da 48 GB+ RAM |

Model tümüyle ekran kartı belleğine sığdığında çok daha hızlı çalışır. Sığmazsa Ollama
kalanını işlemciye taşır ve yavaşlar. Kontrol için cevap üretilirken `ollama ps` çalıştırın.

Değişiklikten sonra Jarvis'i yeniden başlatın. Eski modeli silmek için `ollama rm qwen2.5:7b`.

---

## 6. Yapılandırma

Ayarlar `jarvis/.env` dosyasındadır (kurulumda `.env.example`'dan üretilir):

| Ayar | Açıklama |
|---|---|
| `JARVIS_MODEL` | Kullanılacak Ollama modeli |
| `OLLAMA_HOST` | Ollama adresi (varsayılan `http://localhost:11434`) |
| `JARVIS_NAME` | Asistanın adı |
| `WHISPER_MODEL` | `tiny` / `base` / `small` / `medium` — büyüdükçe daha isabetli, daha yavaş |
| `WHISPER_DEVICE` | `cpu` (varsayılan, her zaman çalışır) veya `cuda`. CUDA kütüphaneleri eksikse Jarvis kendiliğinden CPU'ya döner |
| `MIC_SILENCE_THRESHOLD` | Sessizlik eşiğinin alt sınırı. Ortam ölçümü bunun altında kalırsa bu değer kullanılır |
| `MIC_NOISE_FACTOR` | Ortam gürültüsünün kaç katı "konuşma" sayılsın. `2.0` daha hassas, `5.0` sadece yüksek sesi alır (varsayılan `3.0`) |
| `MIC_SILENCE_SECONDS` | Konuşma bitince beklenecek süre |
| `JARVIS_BARGE` | `1` konuşurken araya girilebilir, `0` kapalı |
| `JARVIS_BARGE_FACTOR` | Araya girme hassasiyeti. Atlas kendi sesiyle kesiliyorsa yükseltin |
| `JARVIS_FOLLOWUP_SECONDS` | Cevaptan sonra uyandırma sözcüğü gerekmeyen süre |
| `JARVIS_THINK` | `0` model doğrudan cevaplar (hızlı), `1` cevaptan önce kendi kendine akıl yürütür (daha isabetli ama çok daha yavaş) |
| `JARVIS_WEB` | `1` internet araması açık, `0` kapalı |
| `JARVIS_WEB_RESULTS` | Kaç arama sonucu modele verilsin (varsayılan 5) |
| `JARVIS_WEB_REGION` | Arama bölgesi (varsayılan `tr-tr`) |
| `PIPER_VOICE` | Türkçe ses dosyası; boş bırakılırsa espeak-ng kullanılır |

Asistanın karakterini değiştirmek için `jarvis.py` içindeki `SYSTEM_PROMPT` metnini düzenleyin.

---

## 7. Sorun giderme

**"Ollama çalışmıyor" hatası**
```bash
sudo systemctl status ollama
sudo systemctl restart ollama
```

**"model bulunamadı" hatası**
```bash
ollama list          # kurulu modeller
ollama pull qwen2.5:3b
```

**Mikrofon bulunamıyor / ses gelmiyor**
```bash
arecord -l                       # mikrofon listesi
arecord -d 3 test.wav && aplay test.wav   # 3 saniye kayıt + oynat
```
Ses kaydı boş çıkıyorsa Ayarlar → Ses → Giriş bölümünden doğru cihazı seçin.

**Uygulama menüsünde "Jarvis" görünmüyor**
`python3-tk` kurulu olmayabilir:
```bash
sudo apt install -y python3-tk
cd ~/atlas-asistan/jarvis && bash install.sh
```

**Ses tanıma `libcublas.so.12 is not found` hatası veriyor**
Ekran kartı hızlandırması için CUDA kütüphaneleri gerekir. Jarvis varsayılan olarak
CPU kullanır ve bu hatayı almamalısınız; `.env` içinde `WHISPER_DEVICE=cpu` olduğundan
emin olun. (Dil modeli tarafı bundan etkilenmez, Ollama GPU'yu kendi kullanır.)

**Cevapta uzun İngilizce muhakeme görünüyor**
`qwen3` gibi modeller akıl yürütmesini cevabın içine gömer. Atlas bunu ayıklar; ayrıca
sistem istemine `/no_think` işareti koyar. Yine de görüyorsanız Ollama'nız eski olabilir,
güncelleyin: `curl -fsSL https://ollama.com/install.sh | sh`

**Cevap gelmiyor, uygulama donmuş gibi**
`qwen3` gibi modeller cevaptan önce kendi kendine akıl yürütebilir. Bu kapalı gelir
(`JARVIS_THINK=0`); açtıysanız durum satırında "akil yurutuyor... N sn" yazar, donma değildir.
Durum satırı hiç ilerlemiyorsa `ollama ps` ile modelin yüklenip yüklenmediğine bakın.

**Atlas kendi kendini kesiyor**
Hoparlör sesi mikrofona kaçıyor. `.env` içinde `JARVIS_BARGE_FACTOR=6.0` yapın, sesi kısın
ya da kulaklık kullanın.

**İngilizce cevap veriyor**
Sistem isteminde Türkçe zorunluluğu var; yine de olursa `.env` içinde `JARVIS_THINK=0`
olduğundan emin olun ve sohbeti temizleyip yeniden deneyin.

**Mikrofon konuşmadığım şeyleri yazıyor**
Sessizlikte ses tanıma metin uydurabilir. `.env` içinde `MIC_NOISE_FACTOR` değerini
yükseltin (ör. `4.0`) ya da `WHISPER_MODEL=medium` deneyin.

**Cevaplar çok yavaş**
Daha küçük bir modele geçin (`.env` içinde `JARVIS_MODEL=qwen2.5:3b`) ve
`WHISPER_MODEL=base` yapın. Nvidia ekran kartınız varsa güncel sürücülerle
Ollama otomatik GPU kullanır; kontrol için `ollama ps` (PROCESSOR sütunu).

**Türkçe karakterler bozuk okunuyor**
Piper sesi inmemiş olabilir; espeak-ng yedeği Türkçeyi daha kaba okur:
```bash
ls -lh voices/    # tr_TR-dfki-medium.onnx dosyası burada olmalı
```
Yoksa `bash install.sh` komutunu tekrar çalıştırın.

---

## 8. Güncelleme

```bash
cd ~/atlas-asistan
git pull
```

Yalnızca Python dosyaları değiştiyse yeniden kuruluma gerek yoktur. Sistem paketi ya da
masaüstü kısayolu değiştiyse `cd jarvis && bash install.sh` komutunu tekrar çalıştırın.

---

## 9. Donanım gereksinimi

| RAM | Önerilen model | Beklenen hız (CPU) |
|---|---|---|
| 16 GB+ | `qwen2.5:7b` | akıcı |
| 8 GB | `qwen2.5:3b` | iyi |
| 4 GB | `qwen2.5:1.5b` | idare eder |

Disk: model başına ~1–5 GB, Whisper `small` için ~0,5 GB.
