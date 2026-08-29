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
NAME = os.getenv("JARVIS_NAME", "Jarvis")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")
WHISPER_LANG = os.getenv("WHISPER_LANG", "tr")
SILENCE_THRESHOLD = float(os.getenv("MIC_SILENCE_THRESHOLD", "0.012"))
SILENCE_SECONDS = float(os.getenv("MIC_SILENCE_SECONDS", "1.2"))
MAX_SECONDS = float(os.getenv("MIC_MAX_SECONDS", "20"))
SAMPLE_RATE = 16000

SYSTEM_PROMPT = (
    f"Sen {NAME} adinda, Turkce konusan bir kisisel asistansin. "
    "Kullaniciya kisa, net ve dogal cumlelerle yanit ver. "
    "Cevaplarin sesli okunacagi icin madde isareti, emoji ve markdown bicimlendirmesi kullanma; "
    "duz cumlelerle konus. Bilmedigin bir sey oldugunda tahmin yurutmek yerine bilmedigini soyle."
)

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


def chat_stream(messages: list[dict], on_token) -> str:
    """Ollama /api/chat akisini token token isler, tam cevabi dondurur."""
    payload = {"model": MODEL, "messages": messages, "stream": True}
    reply = []
    with requests.post(f"{OLLAMA_HOST}/api/chat", json=payload, stream=True, timeout=600) as r:
        r.raise_for_status()
        for line in r.iter_lines(decode_unicode=True):
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            if data.get("error"):
                raise RuntimeError(data["error"])
            token = data.get("message", {}).get("content", "")
            if token:
                reply.append(token)
                on_token(token)
            if data.get("done"):
                break
    return "".join(reply)


# ------------------------------------------------------------------------ TTS
class Speaker:
    """Piper varsa onu, yoksa espeak-ng'yi kullanir."""

    def __init__(self, enabled: bool = True):
        self.enabled = enabled
        self.voice = None
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

    def say(self, text: str) -> None:
        text = text.strip()
        if not self.enabled or not text:
            return
        if self.voice is not None:
            self._say_piper(text)
        else:
            subprocess.run(["espeak-ng", "-v", "tr", "-s", "160", text], check=False)

    def _say_piper(self, text: str) -> None:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            path = tmp.name
        try:
            with wave.open(path, "wb") as wav:
                self.voice.synthesize(text, wav)
            player = shutil.which("aplay") or shutil.which("paplay") or shutil.which("ffplay")
            if player is None:
                return
            cmd = [player, path]
            if player.endswith("ffplay"):
                cmd = [player, "-nodisp", "-autoexit", "-loglevel", "quiet", path]
            subprocess.run(cmd, check=False,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
        print(f"{C_DIM}Ses tanima modeli yukleniyor ({WHISPER_MODEL})...{C_RESET}")
        self.model = WhisperModel(WHISPER_MODEL, device="auto", compute_type="int8")

    def record(self) -> "list":
        np, sd = self.np, self.sd
        block = int(SAMPLE_RATE * 0.1)  # 100 ms
        silence_blocks = int(SILENCE_SECONDS / 0.1)
        max_blocks = int(MAX_SECONDS / 0.1)
        frames, quiet, started = [], 0, False

        with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32",
                            blocksize=block) as stream:
            for _ in range(max_blocks):
                chunk, _overflow = stream.read(block)
                frames.append(chunk.copy())
                level = float(np.sqrt(np.mean(np.square(chunk))))
                if level > SILENCE_THRESHOLD:
                    started, quiet = True, 0
                elif started:
                    quiet += 1
                    if quiet >= silence_blocks:
                        break
        if not started:
            return np.zeros(0, dtype="float32")
        return np.concatenate(frames, axis=0).flatten()

    def listen(self) -> str:
        audio = self.record()
        if len(audio) == 0:
            return ""
        segments, _info = self.model.transcribe(audio, language=WHISPER_LANG, vad_filter=True)
        return " ".join(s.text.strip() for s in segments).strip()


# ----------------------------------------------------------------------- akis
def print_stream_token(token: str) -> None:
    sys.stdout.write(token)
    sys.stdout.flush()


def ask(messages: list[dict], speaker: Speaker | None) -> str:
    print(f"{C_GREEN}{NAME}:{C_RESET} ", end="", flush=True)
    try:
        reply = chat_stream(messages, print_stream_token)
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
    global MODEL
    parser = argparse.ArgumentParser(description="Jarvis - yerel Turkce asistan")
    parser.add_argument("-p", "--prompt", help="Tek seferlik soru sor ve cik")
    parser.add_argument("--voice", action="store_true", help="Mikrofondan dinle")
    parser.add_argument("--no-tts", action="store_true", help="Sesli yaniti kapat")
    parser.add_argument("--model", help=f"Ollama modeli (varsayilan: {MODEL})")
    args = parser.parse_args()

    if args.model:
        MODEL = args.model

    if not preflight():
        return 1

    speaker = None if args.no_tts else Speaker(enabled=True)
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    if args.prompt:
        messages.append({"role": "user", "content": args.prompt})
        ask(messages, speaker)
        return 0

    listener = None
    if args.voice:
        try:
            listener = Listener()
        except Exception as exc:
            print(f"{C_RED}Sesli mod baslatilamadi: {exc}{C_RESET}")
            print("Yazili moda geciliyor.")

    print(f"{C_CYAN}{NAME} hazir{C_RESET} {C_DIM}(model: {MODEL}) - cikmak icin 'cik' yazin "
          f"ya da Ctrl+C{C_RESET}")
    if listener:
        print(f"{C_DIM}Konusmaya baslamak icin Enter'a basin.{C_RESET}")

    while True:
        try:
            if listener:
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
