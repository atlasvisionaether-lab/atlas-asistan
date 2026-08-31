# Jarvis OS — Kurulum ve Yapılandırma Rehberi (TR)

Kaynak: [Grominet95/jarvis-OS](https://github.com/Grominet95/jarvis-OS) · sürüm `0.3.2` · lisans **AGPL-3.0**
Eklenti deposu: [Grominet95/jarvis-skills](https://github.com/Grominet95/jarvis-skills)

Bu rehber, deponun `README.md`, `setup.sh`, `jarvis` launcher ve `.env.example`
dosyaları doğrudan okunarak hazırlandı. Videodaki özetle deponun gerçeği
arasındaki farklar aşağıda "Düzeltmeler" bölümünde.

---

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
