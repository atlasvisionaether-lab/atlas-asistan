#!/usr/bin/env python3
"""Jarvis - Ollama tabanli Turkce yerel asistan.

Kullanim:
    jarvis                       # yazili sohbet
    jarvis --voice               # sesli sohbet (mikrofon + hoparlor)
    jarvis -p "Bir soru"         # tek seferlik soru
    jarvis --no-tts --voice      # sesle sor, yaziyla cevap al
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import wave
from pathlib import Path

import requests

BASE_DIR = Path(__file__).resolve().parent

try:
    from dotenv import load_dotenv

    load_dotenv(BASE_DIR / ".env")
except ImportError:  # dotenv yoksa sadece ortam degiskenleri kullanilir
    pass

MODEL = os.getenv("JARVIS_MODEL", "qwen2.5:7b")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
NAME = os.getenv("JARVIS_NAME", "Atlas")
WAKE_WORDS = [w.strip().lower() for w in
              os.getenv("JARVIS_WAKE_WORDS", "atlas,atlas asistan").split(",") if w.strip()]
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")
WHISPER_LANG = os.getenv("WHISPER_LANG", "tr")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
SILENCE_THRESHOLD = float(os.getenv("MIC_SILENCE_THRESHOLD", "0.012"))
SILENCE_SECONDS = float(os.getenv("MIC_SILENCE_SECONDS", "1.2"))
MAX_SECONDS = float(os.getenv("MIC_MAX_SECONDS", "20"))
NOISE_FACTOR = float(os.getenv("MIC_NOISE_FACTOR", "3.0"))
WEB_SEARCH = os.getenv("JARVIS_WEB", "1").strip().lower() not in {"0", "false", "hayir", "kapali"}
WEB_RESULTS = int(os.getenv("JARVIS_WEB_RESULTS", "5"))
WEB_REGION = os.getenv("JARVIS_WEB_REGION", "tr-tr")
# qwen3 gibi modeller cevaptan once kendi kendine akil yurutur. Sesli asistanda
# bu uzun bir sessizlik demek; varsayilan olarak kapali.
# Konusurken araya girme (barge-in)
BARGE = os.getenv("JARVIS_BARGE", "1").strip().lower() not in {"0", "false", "hayir", "kapali"}
BARGE_FACTOR = float(os.getenv("JARVIS_BARGE_FACTOR", "4.0"))
BARGE_MIN_SECONDS = float(os.getenv("JARVIS_BARGE_MIN_SECONDS", "0.4"))
FOLLOWUP_SECONDS = float(os.getenv("JARVIS_FOLLOWUP_SECONDS", "6"))
THINK = os.getenv("JARVIS_THINK", "0").strip().lower() in {"1", "true", "evet", "acik"}
SAMPLE_RATE = 16000

def build_system_prompt(web: bool = WEB_SEARCH) -> str:
    """Sistem istemi. Internet araci aciksa yapabildikleri buna gore degisir."""
    yapabildiklerin = (
        "Sohbet etmek, soru cevaplamak, aciklama yapmak, metin yazmak ve duzeltmek, "
        "ceviri, ozetleme, fikir uretmek, kod yazmak ve anlatmak."
    )
    araclarin = (
        "\n\nARACLARIN: Asagidaki isleri gercekten yapabilirsin, cevabi uydurma, "
        "ilgili araci cagir:\n"
        "- saat_tarih: su anki saat, tarih ve gun\n"
        "- hesapla: matematik islemleri\n"
        "- sistem_bilgisi: bellek, disk, calisma suresi, pil durumu\n"
        "- not_ekle / notlari_getir / notlari_sil: kullanicinin notlarini saklarsin\n"
        "- hatirlatici_kur: belirtilen dakika sonra masaustu bildirimi\n"
        "- uygulama_ac: tarayici, hesap makinesi, dosyalar, terminal gibi uygulamalar\n"
        "Arac sonucu HATA ile basliyorsa kullaniciya sorunu sade bir dille anlat."
    )
    yapamadiklarin = (
        "E-posta ve mesaj gondermek, sosyal medya hesaplarina baglanmak, dosyalarin "
        "icerigini okumak ya da degistirmek, takvim islemleri, gecmis sohbetleri "
        "hatirlamak (notlar disinda)."
    )
    if web:
        arac = (
            "\n\nINTERNET: 'internette_ara' adinda bir aracin var. Egitim verilerinde "
            "olmayan ya da degismis olabilecek bir sey soruldugunda (guncel olaylar, hava "
            "durumu, fiyatlar, bir kisinin su anki durumu, yeni cikmis urunler, tarih ve "
            "saat gerektiren bilgiler) once bu araci kullan, sonra sonuclara dayanarak "
            "cevap ver. Genel bilgi, tanim, ceviri, matematik, kod gibi konularda araci "
            "kullanma; kendi bilgisiyle cevap ver. Arama sonuclarindaki bilgiyi aktarirken "
            "hangi kaynaktan geldigini kisaca soyle. Sonuclar sorunun cevabini icermiyorsa "
            "bulamadigini soyle, uydurma."
        )
    else:
        yapamadiklarin = "Internete girmek, guncel bilgi ya da hava durumu getirmek, " + \
            yapamadiklarin[0].lower() + yapamadiklarin[1:]
        arac = ""

    return (
        f"Sen {NAME} adinda bir kisisel asistansin. "
        "Kullanicinin kendi Ubuntu bilgisayarinda, Ollama uzerinde calisiyorsun.\n\n"
        "DIL KURALI: Her zaman Turkce cevap ver. Kullanici hangi dilde yazarsa yazsin, "
        "soru ingilizce de olsa, arama sonuclari ingilizce de olsa cevabin Turkce olacak. "
        "Ingilizce terimleri gerekirse parantez icinde verebilirsin ama cumlelerin Turkce "
        "olmali. Bu kural her kosulda gecerlidir.\n\n"
        f"YAPABILDIKLERIN: {yapabildiklerin}\n\n"
        f"{araclarin}\n\n"
        f"YAPAMADIKLARIN: {yapamadiklarin} Bunlara bagli degilsin. Boyle bir "
        "sey istenirse acikca yapamadigini soyle ve yapabildigin bir alternatif oner. "
        "Sahip olmadigin bir yetenegi asla varmis gibi anlatma."
        f"{arac}\n\n"
        "NASIL KONUSURSUN: Dogrudan cevabi ver. Dusunme adimlarini, kendi kendine "
        "yaptigin degerlendirmeleri ve arac cagrisi planlarini yazma; kullanici sadece "
        "sonucu gorsun. Kisa, net ve dogal cumlelerle konus. Cevaplarin sesli okunacagi icin "
        "madde isareti, emoji ve markdown bicimlendirmesi kullanma; duz cumlelerle konus. "
        "Uzun listeler yerine en onemli iki uc seyi soyle. Bilmedigin bir sey oldugunda "
        "tahmin yurutmek yerine bilmedigini soyle. Unutma: cevabin Turkce olacak."
        # qwen3 ailesi bu isareti gorunce akil yurutmeyi tamamen kapatir
        + ("" if THINK else " /no_think")
    )


SYSTEM_PROMPT = build_system_prompt()

C_CYAN, C_GREEN, C_DIM, C_RED, C_RESET = "\033[1;36m", "\033[1;32m", "\033[2m", "\033[1;31m", "\033[0m"


# --------------------------------------------------------------------- Ollama
def ollama_available() -> bool:
    try:
        requests.get(f"{OLLAMA_HOST}/api/tags", timeout=3).raise_for_status()
        return True
    except Exception:
        return False


def model_installed(model: str) -> bool:
    try:
        tags = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=5).json()
    except Exception:
        return False
    names = {m.get("name", "") for m in tags.get("models", [])}
    return model in names or any(n.split(":")[0] == model.split(":")[0] for n in names)


import jarvis_tools as tools  # noqa: E402  (ayarlar okunduktan sonra)


@tools.arac("internette_ara",
            "Internette arama yapar ve baslik, ozet ve baglantilardan olusan "
            "sonuclari dondurur. Sadece guncel ya da egitim verilerinde bulunmayan "
            "bilgi gerektiginde kullan.",
            {"sorgu": {"type": "string",
                       "description": "Arama sorgusu. Kisa ve anahtar kelimelerden olussun."}},
            ["sorgu"])
def web_search(sorgu: str, limit: int = WEB_RESULTS) -> str:
    """DuckDuckGo uzerinden arama yapar, modele verilecek metni dondurur."""
    try:
        from ddgs import DDGS
    except ImportError:
        return ("HATA: arama kutuphanesi kurulu degil. Kullaniciya soyle: "
                "jarvis klasorunde 'bash install.sh' calistirmasi gerekiyor.")
    try:
        rows = DDGS().text(sorgu, region=WEB_REGION, max_results=limit)
    except Exception as exc:
        return f"HATA: arama yapilamadi ({exc}). Internet baglantisi olmayabilir."
    if not rows:
        return "Sonuc bulunamadi."

    parcalar = []
    for i, row in enumerate(rows, 1):
        baslik = (row.get("title") or "").strip()
        ozet = (row.get("body") or row.get("description") or "").strip()
        adres = (row.get("href") or row.get("url") or "").strip()
        if len(ozet) > 400:
            ozet = ozet[:400] + "..."
        parcalar.append(f"{i}. {baslik}\n{ozet}\nKaynak: {adres}")
    return "\n\n".join(parcalar)


def aktif_arac_adlari(web: bool) -> list:
    """Internet kapaliyken arama araci modele hic sunulmaz."""
    return [ad for ad in tools.ARACLAR if web or ad != "internette_ara"]


def _run_tool(ad: str, args: dict, on_tool=None) -> str:
    if on_tool is not None:
        on_tool(ad, args or {})
    return tools.calistir(ad, args)


class DusunceSuzgeci:
    """Akistan <think>...</think> bloklarini ayiklar.

    Bazi modeller (qwen3) akil yurutmeyi ayri bir alanda degil, dogrudan
    cevap metninin icinde etiketli olarak gonderir. Etiketler token
    sinirlarina bolunebildigi icin kucuk bir tampon tutulur.
    """

    ACIK = "<think>"
    KAPALI = "</think>"

    def __init__(self):
        self.icerde = False
        self.tampon = ""

    def _kuyruk_uzunlugu(self) -> int:
        """Yarim kalmis bir etiketi bekletmek icin saklanacak karakter sayisi."""
        hedefler = [self.KAPALI] if self.icerde else [self.ACIK, self.KAPALI]
        en_uzun = 0
        for hedef in hedefler:
            for uzunluk in range(len(hedef) - 1, 0, -1):
                if self.tampon.endswith(hedef[:uzunluk]):
                    en_uzun = max(en_uzun, uzunluk)
                    break
        return en_uzun

    def besle(self, token: str) -> "tuple[str, bool]":
        """(gorunur_metin, oncekini_at) dondurur.

        oncekini_at: modelin acilis etiketi gondermeden </think> yazdigi
        durum. Ollama sablonu <think> etiketini isteme kendisi koydugu icin
        model yalnizca kapanisi uretir; o ana kadar akan her sey dusuncedir.
        """
        self.tampon += token
        gorunur = []
        oncekini_at = False
        while True:
            if self.icerde:
                yer = self.tampon.find(self.KAPALI)
                if yer == -1:
                    break
                self.tampon = self.tampon[yer + len(self.KAPALI):]
                self.icerde = False
                continue
            acilis = self.tampon.find(self.ACIK)
            kapanis = self.tampon.find(self.KAPALI)
            if kapanis != -1 and (acilis == -1 or kapanis < acilis):
                gorunur.clear()
                oncekini_at = True
                self.tampon = self.tampon[kapanis + len(self.KAPALI):]
                continue
            if acilis == -1:
                break
            gorunur.append(self.tampon[:acilis])
            self.tampon = self.tampon[acilis + len(self.ACIK):]
            self.icerde = True
        if self.icerde:
            kuyruk = self._kuyruk_uzunlugu()
            self.tampon = self.tampon[len(self.tampon) - kuyruk:] if kuyruk else ""
        else:
            kuyruk = self._kuyruk_uzunlugu()
            if kuyruk:
                gorunur.append(self.tampon[:-kuyruk])
                self.tampon = self.tampon[-kuyruk:]
            else:
                gorunur.append(self.tampon)
                self.tampon = ""
        return "".join(gorunur), oncekini_at

    def bitir(self) -> str:
        """Akis bitti; bekleyen metni dondurur."""
        if self.icerde:
            self.tampon = ""
            return ""
        kalan, self.tampon = self.tampon, ""
        return kalan


def _stream_once(payload: dict, on_token, on_think=None, on_discard=None) -> tuple:
    """Tek bir /api/chat cagrisini akitir; (metin, arac_cagrilari) dondurur."""
    metin, cagrilar = [], []
    suzgec = DusunceSuzgeci()
    with requests.post(f"{OLLAMA_HOST}/api/chat", json=payload, stream=True,
                       timeout=600) as r:
        if r.status_code >= 400:
            raise requests.exceptions.HTTPError(r.text, response=r)
        for line in r.iter_lines(decode_unicode=True):
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            if data.get("error"):
                raise RuntimeError(data["error"])
            mesaj = data.get("message", {})
            dusunce = mesaj.get("thinking") or ""
            if dusunce and on_think is not None:
                on_think(dusunce)
            token = mesaj.get("content", "")
            if token:
                if suzgec.icerde or "<think" in token or suzgec.tampon:
                    if on_think is not None:
                        on_think(token)
                gorunur, oncekini_at = suzgec.besle(token)
                if oncekini_at:
                    metin.clear()
                    if on_discard is not None:
                        on_discard()
                if gorunur:
                    metin.append(gorunur)
                    on_token(gorunur)
            if mesaj.get("tool_calls"):
                cagrilar.extend(mesaj["tool_calls"])
            if data.get("done"):
                break
    kalan = suzgec.bitir()
    if kalan:
        metin.append(kalan)
        on_token(kalan)
    return "".join(metin), cagrilar


def chat_stream(messages: list, on_token, on_tool=None, web_enabled: bool = None,
                max_rounds: int = 6, on_think=None, on_discard=None) -> str:
    """Ollama ile sohbet eder; model arac cagirirsa aramayi yapip devam eder.

    Arac sonuclari `messages` listesine eklenir, boylece sohbet gecmisinde kalir.
    """
    if web_enabled is None:
        web_enabled = WEB_SEARCH
    tools_enabled = True     # model arac cagirmayi desteklemiyorsa kapanir
    think_enabled = True
    cevap = ""

    for _ in range(max_rounds):
        payload = {"model": MODEL, "messages": messages, "stream": True}
        if think_enabled:
            payload["think"] = THINK
        if tools_enabled:
            payload["tools"] = tools.specs(aktif_arac_adlari(web_enabled))
        try:
            cevap, cagrilar = _stream_once(payload, on_token, on_think, on_discard)
        except requests.exceptions.HTTPError:
            # Bazi modeller "think" ya da "tools" alanini kabul etmez; sirayla birak
            if think_enabled:
                think_enabled = False
                continue
            if tools_enabled:
                tools_enabled = False
                continue
            raise
        if not cagrilar:
            return cevap

        messages.append({"role": "assistant", "content": cevap,
                         "tool_calls": cagrilar})
        for cagri in cagrilar:
            islev = cagri.get("function", {})
            args = islev.get("arguments") or {}
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except json.JSONDecodeError:
                    args = {"sorgu": args}
            sonuc = _run_tool(islev.get("name", ""), args, on_tool)
            messages.append({"role": "tool", "name": islev.get("name", ""),
                             "content": sonuc})
    return cevap


# ------------------------------------------------------------------------ TTS
class Speaker:
    """Piper varsa onu, yoksa espeak-ng'yi kullanir."""

    def __init__(self, enabled: bool = True):
        self.enabled = enabled
        self.voice = None
        self._proc = None
        if not enabled:
            return
        voice_path = os.getenv("PIPER_VOICE", "")
        if voice_path:
            p = Path(voice_path)
            if not p.is_absolute():
                p = BASE_DIR / p
            if p.exists():
                try:
                    from piper.voice import PiperVoice

                    self.voice = PiperVoice.load(str(p))
                except Exception as exc:  # pragma: no cover
                    print(f"{C_DIM}(piper yuklenemedi: {exc}; espeak-ng kullanilacak){C_RESET}")
        if self.voice is None and not shutil.which("espeak-ng"):
            print(f"{C_DIM}(TTS bulunamadi; sesli yanit kapali){C_RESET}")
            self.enabled = False

    def say(self, text: str, should_stop=None) -> bool:
        """Metni seslendirir.

        should_stop() True dondugunde konusma yarida kesilir.
        Kesildiyse True doner. Ses uretilemezse sohbet aksamaz.
        """
        text = text.strip()
        if not self.enabled or not text:
            return False
        if self.voice is not None:
            try:
                return self._say_piper(text, should_stop)
            except Exception as exc:
                print(f"{C_DIM}(piper seslendiremedi: {exc}; espeak-ng deneniyor){C_RESET}")
                self.voice = None
        if shutil.which("espeak-ng"):
            return self._calistir(["espeak-ng", "-v", "tr", "-s", "160", text],
                                  should_stop)
        self.enabled = False
        return False

    def _calistir(self, cmd: list, should_stop=None) -> bool:
        """Oynatici sureci baslatir; should_stop gelirse durdurur."""
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL)
        except FileNotFoundError:
            return False
        self._proc = proc
        kesildi = False
        try:
            while proc.poll() is None:
                if should_stop is not None and should_stop():
                    proc.terminate()
                    kesildi = True
                    break
                time.sleep(0.05)
        finally:
            self._proc = None
            if proc.poll() is None:
                proc.terminate()
        return kesildi

    def stop(self) -> None:
        """Devam eden seslendirmeyi disaridan durdurur."""
        proc = self._proc
        if proc is not None and proc.poll() is None:
            proc.terminate()

    def _synthesize(self, text: str, wav: "wave.Wave_write") -> None:
        """Piper surumleri arasinda degisen synthesize API'sini tek noktada toplar."""
        voice = self.voice
        # piper-tts >= 1.3: wav basliklarini kendisi yazar
        if hasattr(voice, "synthesize_wav"):
            voice.synthesize_wav(text, wav)
            return
        # piper-tts 1.2: synthesize(text, wav_file)
        try:
            voice.synthesize(text, wav)
            return
        except TypeError:
            pass
        # ara surumler: AudioChunk ureteci dondurur, basliklari biz yazariz
        header_written = False
        for chunk in voice.synthesize(text):
            if not header_written:
                wav.setnchannels(chunk.sample_channels)
                wav.setsampwidth(chunk.sample_width)
                wav.setframerate(chunk.sample_rate)
                header_written = True
            wav.writeframes(chunk.audio_int16_bytes)
        if not header_written:
            raise RuntimeError("piper ses uretmedi")

    def _say_piper(self, text: str, should_stop=None) -> bool:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            path = tmp.name
        try:
            with wave.open(path, "wb") as wav:
                self._synthesize(text, wav)
            player = shutil.which("aplay") or shutil.which("paplay") or shutil.which("ffplay")
            if player is None:
                return False
            cmd = [player, path]
            if player.endswith("ffplay"):
                cmd = [player, "-nodisp", "-autoexit", "-loglevel", "quiet", path]
            return self._calistir(cmd, should_stop)
        finally:
            Path(path).unlink(missing_ok=True)


# ------------------------------------------------------------------------ STT
class Listener:
    """Mikrofondan kayit alip faster-whisper ile Turkce metne cevirir."""

    def __init__(self):
        import numpy as np
        import sounddevice as sd
        from faster_whisper import WhisperModel

        self.np = np
        self.sd = sd
        self._WhisperModel = WhisperModel
        print(f"{C_DIM}Ses tanima modeli yukleniyor ({WHISPER_MODEL}, {WHISPER_DEVICE})...{C_RESET}")
        self.model = self._load(WHISPER_DEVICE)

    def _load(self, device: str):
        """CUDA istenip de kutuphaneler eksikse sessizce CPU'ya duser."""
        compute = "float16" if device == "cuda" else "int8"
        try:
            return self._WhisperModel(WHISPER_MODEL, device=device, compute_type=compute)
        except Exception as exc:
            if device == "cpu":
                raise
            print(f"{C_DIM}({device} kullanilamadi: {exc}; CPU'ya geciliyor){C_RESET}")
            return self._WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")

    def record(self, should_stop=None, on_level=None,
               max_seconds: float = None, calibrate: bool = True) -> "list":
        """Mikrofondan kayit alir.

        Ilk yarim saniyede ortam gurultusunu olcup sessizlik esigini ona gore
        belirler; boylece gurultulu odalarda "konusma bitti" anini kacirmaz.
        should_stop() True donerse kayit hemen biter (kullanici durdurdu).
        """
        np, sd = self.np, self.sd
        block = int(SAMPLE_RATE * 0.1)  # 100 ms
        silence_blocks = max(1, int(SILENCE_SECONDS / 0.1))
        max_blocks = max(1, int((max_seconds or MAX_SECONDS) / 0.1))
        calib_blocks = 5 if calibrate else 0  # 500 ms ortam olcumu
        frames, noise, quiet, started, manuel = [], [], 0, False, False
        threshold = SILENCE_THRESHOLD

        with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32",
                            blocksize=block) as stream:
            for i in range(max_blocks):
                if should_stop is not None and should_stop():
                    manuel = True
                    break
                chunk, _overflow = stream.read(block)
                frames.append(chunk.copy())
                level = float(np.sqrt(np.mean(np.square(chunk))))

                if i < calib_blocks:
                    noise.append(level)
                    if i == calib_blocks - 1:
                        floor = sum(noise) / len(noise)
                        threshold = max(SILENCE_THRESHOLD, floor * NOISE_FACTOR)
                    continue

                if on_level is not None:
                    on_level(level, threshold, (i + 1) * 0.1, started)

                if level > threshold:
                    started, quiet = True, 0
                elif started:
                    quiet += 1
                    if quiet >= silence_blocks:
                        break

        if not started and not manuel:
            return np.zeros(0, dtype="float32")
        if not frames:
            return np.zeros(0, dtype="float32")
        return np.concatenate(frames, axis=0).flatten()

    def wait_for_speech(self, should_stop=None, factor: float = None,
                        min_seconds: float = None) -> bool:
        """Kullanici konusmaya baslayana kadar bekler.

        Atlas konusurken calisir: once kisa bir sessiz an olculur, sonra bu
        seviyenin belirgin ustunde ve sureklilik gosteren bir ses aranir.
        Konusma algilanirsa True, should_stop() ile birakilirsa False doner.
        """
        np, sd = self.np, self.sd
        factor = factor if factor is not None else BARGE_FACTOR
        min_seconds = min_seconds if min_seconds is not None else BARGE_MIN_SECONDS
        block = int(SAMPLE_RATE * 0.05)  # 50 ms, hizli tepki
        gerekli = max(1, int(min_seconds / 0.05))
        olcum, esik, ustuste = [], None, 0

        with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32",
                            blocksize=block) as stream:
            while True:
                if should_stop is not None and should_stop():
                    return False
                chunk, _overflow = stream.read(block)
                level = float(np.sqrt(np.mean(np.square(chunk))))
                if esik is None:
                    olcum.append(level)
                    if len(olcum) >= 4:  # 200 ms ortam olcumu
                        taban = sum(olcum) / len(olcum)
                        esik = max(SILENCE_THRESHOLD * factor, taban * factor)
                    continue
                if level > esik:
                    ustuste += 1
                    if ustuste >= gerekli:
                        return True
                else:
                    ustuste = 0

    def listen(self, should_stop=None, on_level=None, max_seconds: float = None,
               calibrate: bool = True) -> str:
        audio = self.record(should_stop=should_stop, on_level=on_level,
                            max_seconds=max_seconds, calibrate=calibrate)
        if len(audio) == 0:
            return ""
        try:
            return self._transcribe(audio)
        except RuntimeError as exc:
            # libcublas/libcudnn eksikse hata ancak burada, cozumleme sirasinda cikar
            if "cannot be loaded" not in str(exc) and "not found" not in str(exc):
                raise
            print(f"{C_DIM}(GPU ses tanima calismadi: {exc}; CPU'ya geciliyor){C_RESET}")
            self.model = self._load("cpu")
            return self._transcribe(audio)

    def _transcribe(self, audio) -> str:
        segments, _info = self.model.transcribe(
            audio,
            language=WHISPER_LANG,
            vad_filter=True,
            # sessizlikte uydurma metin uretilmesini azaltir
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
            temperature=0.0,
        )
        parcalar = [s.text.strip() for s in segments
                    if getattr(s, "no_speech_prob", 0.0) < 0.6 and s.text.strip()]
        return " ".join(parcalar).strip()


# ----------------------------------------------------------------------- akis
def print_stream_token(token: str) -> None:
    sys.stdout.write(token)
    sys.stdout.flush()


def wake_match(text: str) -> "tuple[bool, str]":
    """Metin uyandirma sozcugu ile basliyor mu?

    (uyandi_mi, komut) dondurur. Komut, uyandirma sozcugunden sonrasidir;
    bos ise kullanici sadece seslenmis demektir.
    """
    ham = (text or "").strip()
    if not ham:
        return False, ""
    # ses tanima noktalama ekleyebilir: "Atlas, saat kac?" / "Atlas!"
    sade = ham.lower().replace("!", " ").replace(",", " ").replace(".", " ")
    sade = sade.replace("?", " ").replace(":", " ").strip()
    sade = " ".join(sade.split())

    kelimeler = sade.split()
    for kelime in sorted(WAKE_WORDS, key=len, reverse=True):
        parca = kelime.split()
        # uyandirma sozcugu cumlenin basinda ya da ilk birkac kelime icinde olmali
        # ("Atlas saat kac" ve "Merhaba Atlas saat kac" ikisi de gecerli)
        for i in range(min(len(kelimeler), 3)):
            if kelimeler[i:i + len(parca)] == parca:
                atilacak = i + len(parca)
                kalan = " ".join(ham.split()[atilacak:]).lstrip(",;:!? ").strip()
                return True, kalan
    return False, ""


def arac_metni(ad: str, args: dict) -> str:
    """Calistirilan araci kullaniciya anlatan kisa metin."""
    if ad == "internette_ara":
        return f"internette araniyor: {args.get('sorgu', '')}"
    if ad == "hesapla":
        return f"hesaplaniyor: {args.get('ifade', '')}"
    if ad == "uygulama_ac":
        return f"uygulama aciliyor: {args.get('uygulama', '')}"
    return f"{ad} calistiriliyor"


def _tool_notice(ad: str, args: dict) -> None:
    print(f"\n{C_DIM}({arac_metni(ad, args)}){C_RESET}\n"
          f"{C_GREEN}{NAME}:{C_RESET} ", end="", flush=True)


def ask(messages: list[dict], speaker: Speaker | None) -> str:
    print(f"{C_GREEN}{NAME}:{C_RESET} ", end="", flush=True)
    try:
        reply = chat_stream(messages, print_stream_token, on_tool=_tool_notice)
    except requests.exceptions.ConnectionError:
        print(f"\n{C_RED}Ollama'ya baglanilamadi ({OLLAMA_HOST}). "
              f"'sudo systemctl start ollama' deneyin.{C_RESET}")
        return ""
    except Exception as exc:
        print(f"\n{C_RED}Hata: {exc}{C_RESET}")
        return ""
    print()
    if speaker:
        speaker.say(reply)
    return reply


def preflight() -> bool:
    if not ollama_available():
        print(f"{C_RED}Ollama calismiyor ({OLLAMA_HOST}).{C_RESET}")
        print("  sudo systemctl start ollama    # ya da ayri bir terminalde: ollama serve")
        return False
    if not model_installed(MODEL):
        print(f"{C_RED}'{MODEL}' modeli bulunamadi.{C_RESET}")
        print(f"  ollama pull {MODEL}")
        return False
    return True


def main() -> int:
    global MODEL, WEB_SEARCH, SYSTEM_PROMPT
    parser = argparse.ArgumentParser(description="Jarvis - yerel Turkce asistan")
    parser.add_argument("-p", "--prompt", help="Tek seferlik soru sor ve cik")
    parser.add_argument("--voice", action="store_true", help="Mikrofondan dinle")
    parser.add_argument("--wake", action="store_true",
                        help="Surekli dinle, uyandirma sozcugunu bekle (--voice gerektirmez)")
    parser.add_argument("--no-tts", action="store_true", help="Sesli yaniti kapat")
    parser.add_argument("--model", help=f"Ollama modeli (varsayilan: {MODEL})")
    parser.add_argument("--no-web", action="store_true",
                        help="Internet aramasini kapat")
    args = parser.parse_args()

    if args.model:
        MODEL = args.model
    if args.no_web:
        WEB_SEARCH = False
        SYSTEM_PROMPT = build_system_prompt(web=False)

    if not preflight():
        return 1

    speaker = None if args.no_tts else Speaker(enabled=True)
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    if args.prompt:
        messages.append({"role": "user", "content": args.prompt})
        ask(messages, speaker)
        return 0

    listener = None
    if args.wake:
        args.voice = True
    if args.voice:
        try:
            listener = Listener()
        except Exception as exc:
            print(f"{C_RED}Sesli mod baslatilamadi: {exc}{C_RESET}")
            print("Yazili moda geciliyor.")

    print(f"{C_CYAN}{NAME} hazir{C_RESET} {C_DIM}(model: {MODEL}"
          f"{', internet acik' if WEB_SEARCH else ''}) - cikmak icin 'cik' yazin "
          f"ya da Ctrl+C{C_RESET}")
    if listener and args.wake:
        uyandirma = WAKE_WORDS[0].title() if WAKE_WORDS else NAME
        print(f"{C_DIM}Surekli dinleme acik. '{uyandirma}' diye seslenip talimatinizi "
              f"soyleyin. Cikmak icin Ctrl+C.{C_RESET}")
    elif listener:
        print(f"{C_DIM}Konusmaya baslamak icin Enter'a basin.{C_RESET}")

    while True:
        try:
            if listener and args.wake:
                print(f"{C_DIM}dinliyorum...{C_RESET}", end="\r", flush=True)
                duyulan = listener.listen()
                if not duyulan:
                    continue
                uyandi, user_text = wake_match(duyulan)
                if not uyandi:
                    continue
                if not user_text:
                    print(f"{C_GREEN}{NAME}:{C_RESET} Efendim?")
                    if speaker:
                        speaker.say("Efendim?")
                    user_text = listener.listen()
                    if not user_text:
                        continue
                print(f"{C_CYAN}Sen:{C_RESET} {user_text}")
            elif listener:
                input(f"{C_CYAN}[Enter ile konus]{C_RESET} ")
                print(f"{C_DIM}Dinliyorum...{C_RESET}")
                user_text = listener.listen()
                if not user_text:
                    print(f"{C_DIM}Ses algilanmadi.{C_RESET}")
                    continue
                print(f"{C_CYAN}Sen:{C_RESET} {user_text}")
            else:
                user_text = input(f"{C_CYAN}Sen:{C_RESET} ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGorusuruz!")
            return 0

        if not user_text:
            continue
        if user_text.lower() in {"cik", "çık", "exit", "quit", "kapan"}:
            print("Gorusuruz!")
            return 0

        messages.append({"role": "user", "content": user_text})
        reply = ask(messages, speaker)
        if reply:
            messages.append({"role": "assistant", "content": reply})
        else:
            messages.pop()


if __name__ == "__main__":
    sys.exit(main())
