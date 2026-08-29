# Jarvis — Ubuntu için yerel Türkçe sesli asistan

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

### Sesli mod nasıl çalışır?

`--voice` modunda Enter'a basıp konuşursunuz. Jarvis, ~1,2 saniye sessizlik
algıladığında kaydı bitirir, konuşmanızı metne çevirir, cevabı üretir ve sesli okur.

---

## 3. Yapılandırma

Ayarlar `jarvis/.env` dosyasındadır (kurulumda `.env.example`'dan üretilir):

| Ayar | Açıklama |
|---|---|
| `JARVIS_MODEL` | Kullanılacak Ollama modeli |
| `OLLAMA_HOST` | Ollama adresi (varsayılan `http://localhost:11434`) |
| `JARVIS_NAME` | Asistanın adı |
| `WHISPER_MODEL` | `tiny` / `base` / `small` / `medium` — büyüdükçe daha isabetli, daha yavaş |
| `MIC_SILENCE_THRESHOLD` | Mikrofon sessizlik eşiği. Jarvis erken kesiyorsa düşürün (ör. `0.008`), gürültüde takılıyorsa yükseltin (ör. `0.02`) |
| `MIC_SILENCE_SECONDS` | Konuşma bitince beklenecek süre |
| `PIPER_VOICE` | Türkçe ses dosyası; boş bırakılırsa espeak-ng kullanılır |

Asistanın karakterini değiştirmek için `jarvis.py` içindeki `SYSTEM_PROMPT` metnini düzenleyin.

---

## 4. Sorun giderme

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

## 5. Donanım gereksinimi

| RAM | Önerilen model | Beklenen hız (CPU) |
|---|---|---|
| 16 GB+ | `qwen2.5:7b` | akıcı |
| 8 GB | `qwen2.5:3b` | iyi |
| 4 GB | `qwen2.5:1.5b` | idare eder |

Disk: model başına ~1–5 GB, Whisper `small` için ~0,5 GB.
