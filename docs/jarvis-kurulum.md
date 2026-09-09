# Jarvis OS — Kurulum ve Yapılandırma Rehberi (TR)

Kaynak: [Grominet95/jarvis-OS](https://github.com/Grominet95/jarvis-OS) · sürüm `0.3.2` · lisans **AGPL-3.0**
Eklenti deposu: [Grominet95/jarvis-skills](https://github.com/Grominet95/jarvis-skills)

Bu rehber, deponun `README.md`, `setup.sh`, `jarvis` launcher ve `.env.example`
dosyaları doğrudan okunarak hazırlandı. Videodaki özetle deponun gerçeği
arasındaki farklar aşağıda "Düzeltmeler" bölümünde.

---

> **Bu rehber gerçek bir kurulumla doğrulandı.** Ubuntu 24.04 + Python 3.14 (sistem)
> üzerinde uçtan uca kuruldu; yol boyunca upstream'de altı ayrı hata/uyumsuzluk çıktı.
> Hepsi **§9 Bilinen hatalar** bölümünde, tespit yöntemi ve geçici çözümüyle birlikte.
> Kuruluma başlamadan önce o bölümü bir kez okuman birkaç saat kazandırır.

## 0. Önce şu düzeltmeler

| Videodaki / özetteki ifade | Deponun gerçeği |
|---|---|
| `Jarvis éclosion` | Komut aksansız: **`./jarvis eclosion`** (Linux/macOS). Windows'ta karşılığı `.\jarvis.bat setup` |
| `Jarvis Run` | **`./jarvis run`** (Linux/macOS) / `.\jarvis.ps1 run` (Windows) |
| "localhost:8000 üzerinden arayüz" | Doğru, ama **kurulum sihirbazı `127.0.0.1:8765/setup`** portunda. Asıl arayüz kurulumdan sonra `127.0.0.1:8000/admin`. Port meşgulse sihirbaz başka port seçer — `.env` içindeki `PORT` değerine bak |
| "API anahtarlarını ayarla" | Tek bir LLM anahtarı yeter. Anthropic **zorunlu değil**; `API_BACKEND` neyse onun anahtarı gerekir |
| — | Projenin **birincil desteklenen hedefi Windows**. Linux/macOS "geliştirici" yolu olarak destekleniyor (Parcours B/C) |

---

## 1. Ön koşullar

| Gereksinim | Not |
|---|---|
| Python **3.11 – 3.13** | `requires-python = ">=3.11,<3.14"`. 3.14 çalışmaz |
| [uv](https://docs.astral.sh/uv/) | Bağımlılık yöneticisi. Zorunlu — `setup.sh` uv yoksa çıkış veriyor |
| Git | Klonlama için |
| Node.js 18+ | Sadece opsiyonel "Intel Monde" paneli için |
| Docker | Sadece opsiyonel: Skill Lab sandbox + code-agent |

Yüz tanıma (`--extra vision`) `dlib` derliyor: Linux'ta `cmake`, `libopenblas-dev`,
`portaudio19-dev`, `libgl1` paketleri; Windows'ta Visual Studio C++ Build Tools ister.
**İlk kurulumda bunu atla** — sonra ekleyebilirsin.

> **Windows'a özel uyarı:** projeyi **OneDrive altına koyma**. Senkronizasyon,
> gömülü venv'in symlink'lerini bozuyor; Jarvis kurulumu bilerek durduruyor.
> `%USERPROFILE%\jarvis-OS` gibi senkronize olmayan bir yol kullan.

---

## 2. Kurulum — Linux / macOS (geliştirici yolu)

En sade yol, bundle inşa etmeden `uv sync` ile ilerlemek (README'deki Parcours C):

```bash
git clone https://github.com/Grominet95/jarvis-OS.git
cd jarvis-OS

# Bağımlılıklar (yüz tanıma olmadan — hızlı ve sorunsuz)
uv sync

# Kurulum sihirbazını başlat -> http://127.0.0.1:8765/setup
./jarvis eclosion
```

`./jarvis eclosion` aslında `setup.sh`'i çağırır. `setup.sh` sırayla şunu yapar:
1. `bundle/.venv` veya `.venv` içinde bir Python arar.
2. Bulamazsa: bundle inşa etmeyi teklif eder (`y/N`) → hayır dersen `uv sync --extra vision` çalıştırır.
   **Not:** bu fallback `--extra vision` kullanır, yani dlib derlemesi burada devreye girer.
   Bunu istemiyorsan **önce `uv sync` çalıştır** ki `.venv` hazır olsun ve fallback tetiklenmesin.
3. `jarvis.setup_app`'i editable kurar ve web sihirbazını `:8765`'te açar.

### Alternatif: offline bundle inşa etmek

Dağıtım yapacaksan veya her `uv sync`'te tekrar indirmek istemiyorsan:

```bash
bash scripts/release/build_bundle.sh   # bir kez, internetle
./jarvis eclosion
```

Bu `bundle/` içine relocatable Python, venv, ML modelleri (YOLO, Piper),
`livekit-server` ve `manifest.json` koyar (~628 MB).

---

## 3. Kurulum — Windows (son kullanıcı yolu)

```powershell
git clone https://github.com/Grominet95/jarvis-OS.git
cd jarvis-OS          # OneDrive dışında bir yerde olsun

.\jarvis.bat setup    # sihirbaz açılır; 1. adımda "Télécharger" ile bundle iner
.\jarvis.bat run
```

`.bat` kullan, `.ps1` değil: Windows indirilen PowerShell script'lerini varsayılan
olarak engelliyor. `.bat` dosyaları `jarvis.ps1`'i `-ExecutionPolicy Bypass` ile çağırıyor.

---

## 4. `.env` yapılandırması

Sihirbaz `.env`'i senin için yazar; sonradan elle düzenleyebilirsin.
Şablon: depodaki `.env.example` (220 satır). **Minimum çalışır set:**

```env
# Kimlik
USER_FIRSTNAME=Ad
ASSISTANT_NAME=Jarvis
PORT=8000

# LLM — sadece seçtiğin backend'in anahtarı gerekli
LLM_PROVIDER=api
API_BACKEND=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6
VOICE_ANTHROPIC_MODEL=claude-haiku-4-5-20251001

# Hafıza
MEMORY_DIR=memory_data

# İlk kurulumda kapalı tut
FACE_RECOGNITION_ENABLED=false
CLAP_DETECTION_ENABLED=false
WAKEUP_ENABLED=false
DOCKER_ENABLED=false
BRIEFING_ENABLED=false
```

### LLM backend seçenekleri

| `API_BACKEND` | Gereken anahtar | Not |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | Ses için `VOICE_ANTHROPIC_MODEL` |
| `openai` | `OPENAI_API_KEY` | Function calling destekli |
| `mistral` | `MISTRAL_API_KEY` | Function calling destekli |
| `local` (+ `LLM_PROVIDER=local`) | yok | Ollama: `OLLAMA_BASE_URL`, `OLLAMA_MODEL` |

Seçmediğin backend'lerin anahtarlarını `.env.example`'daki örnek değerde bırakabilirsin.

### Ses hattı (LiveKit)

Ses ayrı bir process: `jarvis.interfaces.voice.agent`. `API_BACKEND`'i takip eder;
LiveKit tarafında desteklenmeyen bir backend seçtiysen **Gemini'ye düşer** ve
`GOOGLE_API_KEY` ister. `VOICE_LLM_MODEL` ile elle geçersiz kılabilirsin.

```env
LIVEKIT_URL=wss://projen.livekit.cloud
LIVEKIT_API_KEY=API...
LIVEKIT_API_SECRET=...
STT_PROVIDER=deepgram      # veya whisper (WHISPER_MODEL=tiny)
DEEPGRAM_API_KEY=...
TTS_PROVIDER=elevenlabs    # veya piper (yerel)
ELEVENLABS_API_KEY=sk_...
ELEVENLABS_VOICE_ID=...
```

Yerel `livekit-server` bundle'da geliyor; `./jarvis run` yoksa
`scripts/ensure_livekit.sh` ile otomatik kuruyor. LiveKit Cloud opsiyonel alternatif.

### Google (Gmail / Calendar)

Google Cloud Console'dan aldığın `credentials.json`'ı
**`config/google_credentials.json`** olarak koy. Jarvis ilk açılışta OAuth akışını
başlatıp token'ları yerel kaydeder (gitignore'lu).

### Yüz tanıma (Wake Up sekansı)

```bash
uv sync --extra vision
```
```env
FACE_RECOGNITION_ENABLED=true
FACE_RECOGNITION_THRESHOLD=0.45
```
Referans fotoğrafın: **`vision_data/faces/reference.jpg`** (JPG, yüz net, iyi ışık).
Bu dosya olmadan tarama çalışır ama her zaman "kimlik tanınmadı" döner.
Sihirbazın `/setup` ekranından da yükleyebilirsin.

---

## 5. Çalıştırma

> ⚠️ `./jarvis run` Linux'ta kendini öldürüyor — sebebi ve çözümü §9.2'de.
> Üç bileşeni ayrı ayrı başlat, ya da §10'daki başlatma betiğini kullan.

**Linux / macOS:**

| Komut | Ne yapar |
|---|---|
| `./jarvis eclosion` | Kurulum sihirbazı (`:8765/setup`) |
| `./jarvis run` | LiveKit + API + ses hattı (hepsi) |
| `./jarvis api` | Sadece FastAPI sunucusu |
| `./jarvis voice` | Sadece ses ajanı |
| `./jarvis livekit` | Sadece LiveKit dev sunucusu |

**Windows:** `.\jarvis.ps1 run` / `api` / `setup` / `doctor`

Arayüz: `http://127.0.0.1:8000/admin` (port `.env`'deki `PORT`).
`api` ve `voice` aynı anda çalışabilir — ses ajanı ana gateway'e delege eder,
yani aynı oturumu, hafızayı ve araçları paylaşırlar.

---

## 6. Sorun giderme

- **Hata kodları:** terminal/log'da `[JRV-DOM-NNN]` biçiminde bir kod görürsün
  (ör. `[JRV-KRN-011]`). Kodu ve saati not al; karşılığı
  `scripts/error_audit/error-codes.yaml` içinde.
- **Log dosyaları:** Windows'ta `%TEMP%\jarvis\` altında `livekit.log`, `api.log`,
  `voice.log`. `run` her başlatmada bu üçünü sıfırlar ve artık process'leri öldürür.
- **Hızlı teşhis:** `.\jarvis.ps1 doctor`
- **VPS / headless kurulum:** mikrofon yoksa çift-alkış algılama ve yerel ses hattı
  hiç tetiklenmez. `.env`'e `CLAP_DETECTION_ENABLED=false` koy.
- **`uv sync` dlib'de patlıyor:** `--extra vision`'ı çıkar, düz `uv sync` ile devam et.
- **Port 8000 dolu:** sihirbaz otomatik başka port seçer; `.env`'deki `PORT`'u kontrol et.

---

## 7. Mimari — nereye kod ekleyeceğini bilmek için

Kod 4 katmana ayrılmış ve bu kural CI'da `import-linter` ile **zorlanıyor**:

| Katman | Paket | İçerik |
|---|---|---|
| L0 | `kernel/` | Protocol'ler, şemalar, event bus, ayarlar, izinler, onay akışı |
| L1 | `providers/` | LLM, SQLite Memory Kernel, TTS/STT, Vision, AutoDream |
| L1 | `capabilities/` | Araçlar (browser, Gmail, Calendar, Notion, Spotify, fs, CLI) + Skills |
| L2 | `engine/` | Gateway, Agent, Router, Mission Engine, BudgetGuard, proaktif motor |
| L3 | `interfaces/`, `app.py`, `bootstrap.py` | FastAPI router'ları, LiveKit ses hattı, composition root |

Kurallar: kernel hiçbir şeyi import etmez; providers/capabilities sadece kernel'i;
engine sadece kernel'i import eder. Yeni bir **skill** yazacaksan yeri
`capabilities/skills/`, yeni bir **collector** yazacaksan `engine/proactive/collectors/`.

PR açmadan önce (hata yollarına dokunduysan):
```bash
uv run python scripts/error_audit/check_pr.py
uv run ruff check
uv run lint-imports
uv run pytest -m "not integration"
```

---

## 8. Sıradaki adımlar (senin makinende)

1. `git clone` + `uv sync` (vision'sız)
2. `./jarvis eclosion` → tarayıcıda `:8765/setup` → kimlik + tek bir LLM anahtarı
3. `./jarvis api` ile önce sadece metin sohbetini doğrula (`:8000/admin`)
4. Çalışınca ses katmanını ekle: LiveKit + STT/TTS anahtarları → `./jarvis run`
5. En son opsiyonelleri aç: Google OAuth, yüz tanıma, Telegram botu, Docker sandbox

Bir adımda takılırsan terminal çıktısını ve `[JRV-...]` kodunu bana yapıştır,
birlikte bakalım.


---

## 9. Bilinen hatalar ve geçici çözümler

Aşağıdakilerin hepsi upstream `v0.3.2` üzerinde gerçek bir Ubuntu kurulumunda
karşılaşıldı ve kaynak kodda doğrulandı. Satır numaraları o sürüme ait.

### 9.1 Kurulum sihirbazı `bundle/` olmadan geçmiyor

`src/jarvis/kernel/bundle.py:364`:

```python
"can_continue": bundle_valid,
```

Sihirbazın 1. adımdaki "Devam" düğmesi **yalnızca** geçerli bir `bundle/` klasörü
olup olmadığına bakıyor. `setup.js:849` bu değeri okuyup düğmeyi sessizce iptal
ediyor. Sonuç: README'nin Linux için önerdiği "Parcours C" (`uv sync` +
`./jarvis eclosion`) yolu sihirbazda kilitleniyor — Python "HAZIR" görünse bile.

**Çözüm:** sihirbazı atla, `.env`'i elle yaz (§4). `SETUP_COMPLETE=true` satırı
`setup_layout.py:52`'deki `is_setup_complete()` kontrolünü geçirir, sihirbaz bir
daha araya girmez. `app.py`'de kurulum kapısı yok, doğrudan başlar.

### 9.2 `./jarvis run` kendi kendini öldürüyor

Launcher `run` dalı şunu yapıyor:

```bash
exec /usr/bin/env bash --noprofile --norc -c '
  ...
  pkill -f "livekit-server" 2>/dev/null || true
```

Bu dev betik `bash -c '...'` argümanı olarak çalıştığı için sürecin kendi komut
satırı (`/proc/PID/cmdline`) betiğin tüm metnini içeriyor — `"livekit-server"`
dizesi dahil. `pkill -f` tam komut satırında arama yaptığından kalıp kendi
kabuğuyla eşleşiyor ve onu öldürüyor. Terminalde tek görünen şey `Sonlandırıldı`.

**Çözüm:** üç bileşeni ayrı başlat (`./jarvis livekit`, `./jarvis api`,
`./jarvis voice`) ya da §10'daki betiği kullan.

### 9.3 LiveKit tarayıcı SDK'sı CDN'den geliyor

`index.html:3180` ve `home.html:236`:

```html
<script src="https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.umd.min.js"></script>
```

Reklam engelleyici, katı izleme koruması veya DNS filtresi bunu engellerse
`LivekitClient` tanımsız kalır ve `voice_livekit.js:68` daha ilk satırda durur.
Belirti çok yanıltıcı: **tarayıcı mikrofon iznini bile istemez**, çünkü
`setMicrophoneEnabled` zincirin en sonunda (satır 152).

**Çözüm — kütüphaneyi yerele al:**

```bash
curl -L -o src/jarvis/interfaces/ui/static/livekit-client.umd.min.js \
  https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.umd.min.js
LC_ALL=C sed -i 's|https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.umd.min.js|/livekit-client.umd.min.js|' \
  src/jarvis/interfaces/ui/static/index.html src/jarvis/interfaces/ui/static/home.html
```

Statik dosyalar her istekte diskten okunduğu için API'yi yeniden başlatmaya gerek
yok; tarayıcıda sert yenileme (Ctrl-Shift-R) yeterli.

### 9.4 Gemini TTS ücretsiz kotası günde 10 istek

`TTS_PROVIDER=gemini` seçilirse ilk birkaç cevaptan sonra ses kesilir:

```
google.genai.errors.ClientError: 429 RESOURCE_EXHAUSTED
quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'
quotaValue: '10'
```

Kota **günlük**, dakikalık değil — pratikte kullanılamaz. `agent.py:401`'e göre
`piper` de gerçek zamanlı LiveKit eklentisi olmadığı için ElevenLabs'a düşüyor,
yani yerel TTS de bir seçenek değil.

**Çözüm:** OpenAI TTS ekle. `lk_openai` zaten `agent.py:37`'de içe aktarılmış;
`_build_voice_tts` içine bir `openai` dalı eklemek yeterli. Böylece STT, LLM ve
TTS tek anahtarla çalışır. Sonra `.env`'e:

```env
TTS_PROVIDER=openai
OPENAI_TTS_MODEL=tts-1
OPENAI_TTS_VOICE=alloy
```

### 9.5 Ses ajanı `ctx.connect()` çağırmıyor (livekit-agents 1.5.7)

`agent.py` entrypoint'i odaya elle bağlanıp özel bir iç değişkeni set ediyor:

```python
ctx._connected = True  # empêche la double connexion dans session.start()
```

Bu, eski bir livekit-agents sürümünde çift bağlantıyı engellemek için yazılmış.
1.5.7'de bağlantı durumu artık o değişkenle izlenmiyor; framework
`ctx.connect()` çağrılmamış sayıyor, katılımcı eşleştirmesini yapmıyor
(`input stream attached {"participant": null}`) ve işi kapatıyor:

```
WARNING The job task completed without establishing a connection or performing
        a proper shutdown. Ensure that job_ctx.connect()/job_ctx.shutdown() is called
```

**Çözüm:** elle bağlantıyı devre dışı bırak, `session.start()` öncesinde
framework'ün kendi `await ctx.connect()` metodunu çağır. Uzun `connect_timeout`
gerekçesi yerel LiveKit'te (`127.0.0.1`) zaten geçersiz.

### 9.6 STT ve prompt'ta sabit kodlanmış Fransızca

İki ayrı yer, ikisi de `agent.py`:

```python
# satır ~342 — STT dili
stt = lk_openai.STT(model="gpt-4o-mini-transcribe", language="fr", ...)

# satır ~94 — ses promptunun son satırı
f"Réponds en français sauf si {name} parle en anglais."
```

Türkçe konuşulduğunda STT sesi en yakın Fransızca kelimelere oturtuyor; çıkan
metin anlamsız oluyor. Yazılı sohbet ayrı bir prompt kullanıyor
(`prompts/system_static.md`), ses ajanı onu **okumuyor** — `_build_voice_instructions()`
kendi tabanını üretiyor (`agent.py:101`). Yani dili iki yerde ayrı ayrı düzeltmek gerekiyor.

```bash
LC_ALL=C sed -i 's/language="fr"/language="tr"/g; s/languages="fr-FR"/languages="tr-TR"/g' \
  src/jarvis/interfaces/voice/agent.py
```

Prompt tarafında `system_static.md` sonuna ve `_voice_system_base` içine "her
zaman Türkçe cevap ver" kuralı eklenmeli. Yönlendirme etiketlerine
(`[I]`, `[CF]`, `[BG]`) dokunma — `router.py:78` cevabın ilk token'ından onu okuyor.

### 9.7 Türkçe yerel ayarda `grep '[A-Z]'` tuzağı

Bu upstream hatası değil, ortam tuzağı — ama `.env` düzenlerken canını yakabilir:

```bash
grep -E '^[A-Z_]+=' .env    # tr_TR yerel ayarında I harfini ATLAR
```

`[A-Z]` aralığı ASCII değil, yerel ayarın harf sıralamasına göre çözülüyor.
Türkçe'de noktalı/noktasız I ayrımı yüzünden `I` içeren satırlar (`USER_FIRSTNAME`,
`OPENAI_API_KEY`, `API_BACKEND`...) eşleşmiyor.

**Kural:** `.env` ve kod üzerinde çalışan her `grep`/`sed` komutunun başına
`LC_ALL=C` koy.

---

## 10. Başlatma betiği

§9.2 yüzünden `./jarvis run` kullanılamıyor. Üç bileşeni arka planda başlatan,
loglarını tek yere toplayan betik:

```bash
#!/usr/bin/env bash
cd ~/jarvis-OS
mkdir -p /tmp/jarvis
pkill -f "jarvis.interfaces.voice.agent" 2>/dev/null
pkill -f "jarvis.app" 2>/dev/null
pkill -x livekit-server 2>/dev/null
sleep 1
nohup livekit-server --dev --node-ip 127.0.0.1 \
  --keys "devkey: devsecretdevsecretdevsecretdevsecret" > /tmp/jarvis/livekit.log 2>&1 &
sleep 3
nohup uv run python -m jarvis.app > /tmp/jarvis/api.log 2>&1 &
sleep 6
nohup uv run python -m jarvis.interfaces.voice.agent dev > /tmp/jarvis/voice.log 2>&1 &
sleep 4
ss -ltn | grep -E ":(7880|8000)"
echo BASLATILDI
```

`pkill -x livekit-server` (tam ad eşleşmesi) ve kalıpların betik dosyasının
içinde olması — argümanlarında değil — §9.2'deki kendini öldürme sorununu önler.

Durdurmak için:

```bash
pkill -f "jarvis.interfaces.voice.agent"; pkill -f "jarvis.app"; pkill -x livekit-server
```

---

## 11. Kurulumu doğrulama — LLM'e sormadan

Jarvis'in kendi yetenekleri hakkında söyledikleri **güvenilir değil**. Model kendi
araç listesini okuyamıyor ve sıkça "bu özelliğim yok" diyor — araç kayıtlı ve
çalışır durumdayken bile. Ölçüm için `/api/tools` uç noktalarını kullan.

**Kayıtlı araçları listele:**

```bash
curl -s http://127.0.0.1:8000/api/tools | python3 -c "import json,sys; print([x['name'] for x in json.load(sys.stdin)])"
```

**Bir aracı LLM'i devreden çıkararak çalıştır:**

```bash
curl -s -X POST http://127.0.0.1:8000/api/tools/execute \
  -H 'Content-Type: application/json' \
  -d '{"tool":"list_emails","params":{}}'
```

Bu ikisi, "araç bozuk" ile "model aracı çağırmıyor" arasındaki farkı kesin olarak
ayırır. İkincisiyse çözüm prompt'ta: `system_static.md`'ye aracın adını ve ne
zaman kullanılacağını yazan açık bir kural ekle. Modelin e-posta isteğini `[I]`
(araçsız cevap) diye sınıflandırması sık görülen bir tuzak.

**Ses hattını katman katman doğrula:**

| Ne | Nasıl |
|---|---|
| Sistem mikrofonu | `arecord -f cd -d 5 /tmp/t.wav` sonra tepe genliğini ölç |
| Tarayıcı yakalıyor mu | Konsolda `AnalyserNode` ile 5 saniyelik tepe ölçümü |
| SDK yüklü mü | Konsolda `typeof LivekitClient` → `"object"` olmalı |
| Token üretiliyor mu | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/voice/token` |
| Ajan odada mı | `voice.log`'da `registered worker` ve `participant: "ali"` |

Sorun bu beş katmandan hangisinde kopuyorsa oraya bakılır. Mikrofon izni
istenmiyorsa kopukluk her zaman ilk üçtedir.

---

## 12. Ek yetenekler

### Yerel komut çalıştırma

`run_script` aracı `config/tools.yaml`'dan takma ad okuyor; dosya varsayılan
olarak tamamen yorum satırı. `CLIRunner._run` sabit ikili listesini uygulamıyor,
yani buraya yazdığın komut çalışır. Güven sınırın bu dosya.

```yaml
site_ac:
  command: ["xdg-open"]
  description: "Verilen adresi varsayilan tarayicida acar. Arg olarak tam URL gonder."
  tier: safe

ekran_goruntusu:
  command: ["gnome-screenshot", "-f", "/tmp/jarvis_ekran.png"]
  description: "Ekran goruntusu alir."
  tier: confirm
```

`tier`: `safe` sormadan çalışır, `confirm` onay bekler, `reject` devre dışı.
Bunlardan önce bir tehlikeli desen engeli var (`cli.py:109`): `rm -rf /`, fork
bomb, `mkfs`, `dd of=/dev/`, kabuğa pipe.

`execute_cli`'ın ayrı ve sabit bir ikili listesi var (`cli.py:22`) ve içinde
macOS'un `open`'ı var ama Linux'un `xdg-open`'ı **yok** — "YouTube aç" bu yüzden
Linux'ta çalışmaz, `tools.yaml` yolunu kullanman gerekir.

### E-posta gönderme

Depoda gönderme **aracı yok**. `gmail.py:187`'deki `send_gmail_draft` yalnızca
proaktif motora ve `/api/proactive` uç noktasına bağlı — sohbetten çağrılamıyor.
Sohbetten göndermek için `Tool` alt sınıfı yazıp `bootstrap.py`'daki araç
demetine eklemek gerekiyor.

Böyle bir araç yazarken **iki aşamalı onay** şart: `action='draft'` taslağı
beklemeye alır ve döndürür, yalnızca `action='send'` gerçekten yollar. Gönderim
geri alınamaz; güvenceyi promptun iyi niyetine değil koda koy. Beklemeye alınan
taslağa TTL (5 dk) ve tek kullanım kuralı ekle ki çift gönderim olmasın.

Google tarafı: Cloud Console'da Gmail API'yi etkinleştir, **Masaüstü uygulaması**
tipinde OAuth istemcisi oluştur (Web tipi çalışmaz — JSON'da `installed` yerine
`web` anahtarı olur), JSON'u `config/google_credentials.json`'a koy, OAuth izin
ekranında kendini test kullanıcısı olarak ekle. `_SCOPES` (`gmail.py:18`) zaten
`gmail.readonly` ve `gmail.send` istiyor, ikisi tek yetkilendirmede alınır.

`Hata 401: deleted_client` alırsan elindeki JSON silinmiş bir istemciye ait —
Console'daki listeyle `client_id`'yi karşılaştır.

### Küre animasyonu

Küre iki şekilde hareket eder: duruma göre (`orb.js`'de `state === "speaking"`)
ve sesin anlık şiddetine göre (`setAudioLevel`). İkincisi **hiç bağlı değil** —
`home.js:659` onu yalnızca sunucudan gelen `audio_level` WebSocket mesajıyla
besliyor ve LiveKit yolunda böyle bir mesaj üretilmiyor.

Bağlamak için `home.js`'e bir kanca (`window.__jarvisSetOrbLevel`) ekleyip
`voice_livekit.js`'de ajanın ses kanalına bir `AnalyserNode` takmak yeterli —
tamamen tarayıcı tarafında, sunucuya dokunmadan.
