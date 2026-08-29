#!/usr/bin/env python3
"""Jarvis masaustu penceresi (Tkinter).

Terminal yerine normal bir uygulama penceresi sunar: yazarak ya da
mikrofon dugmesiyle konusarak sohbet edilir. Model cagrilari ayri bir
is parcaciginda calisir, pencere donmaz.
"""
from __future__ import annotations

import queue
import threading
import time
import tkinter as tk
from tkinter import ttk, scrolledtext

import jarvis as core

BG, FG = "#1e1e2e", "#cdd6f4"
BG_INPUT, ACCENT, MUTED = "#313244", "#89b4fa", "#9399b2"
USER_COLOR, BOT_COLOR, ERR_COLOR = "#a6e3a1", "#89b4fa", "#f38ba8"


class JarvisApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.events: queue.Queue = queue.Queue()
        self.messages = [{"role": "system", "content": core.SYSTEM_PROMPT}]
        self.listener = None
        self.busy = False
        self.recording = False
        self.stop_flag = threading.Event()
        self.always_on = threading.Event()
        self.cevap_baslangici = None  # ekrana basilan cevabin baslangic imi
        self.last_barge = False     # son cevap araya girilerek mi kesildi
        self.wait_since = None      # cevap beklenmeye baslanan an
        self.wait_label = ""

        root.title(f"{core.NAME} — Yerel Asistan")
        root.geometry("820x600")
        root.minsize(420, 320)
        root.configure(bg=BG)

        self._build_ui()
        self.speaker = core.Speaker(enabled=True)
        self.root.after(60, self._drain)

        if not core.ollama_available():
            self._say_system(
                f"Ollama calismiyor ({core.OLLAMA_HOST}).\n"
                "Terminalde su komutu calistirin:  sudo systemctl start ollama", error=True)
        elif not core.model_installed(core.MODEL):
            self._say_system(f"'{core.MODEL}' modeli kurulu degil.\n"
                             f"Terminalde:  ollama pull {core.MODEL}", error=True)
        else:
            self._say_system(f"{core.NAME} hazir. Model: {core.MODEL}")

    # ------------------------------------------------------------------ arayuz
    def _build_ui(self) -> None:
        # Onemli: once alt seritler (side="bottom"), sonra sohbet alani.
        # Aksi halde pencere kucuk acildiginda giris kutusu ve dugmeler
        # ekran disinda kaliyor.
        self.chat = scrolledtext.ScrolledText(
            self.root, wrap="word", bg=BG, fg=FG, insertbackground=FG,
            font=("Ubuntu", 12), relief="flat", padx=14, pady=12, state="disabled")
        self.chat.tag_config("user", foreground=USER_COLOR, font=("Ubuntu", 12, "bold"))
        self.chat.tag_config("bot", foreground=BOT_COLOR, font=("Ubuntu", 12, "bold"))
        self.chat.tag_config("body", foreground=FG)
        self.chat.tag_config("sys", foreground=MUTED, font=("Ubuntu", 10, "italic"))
        self.chat.tag_config("err", foreground=ERR_COLOR, font=("Ubuntu", 10))

        foot = tk.Frame(self.root, bg=BG)
        foot.pack(side="bottom", fill="x", padx=10, pady=(0, 8))

        bar = tk.Frame(self.root, bg=BG)
        bar.pack(side="bottom", fill="x", padx=10, pady=(0, 8))

        self.entry = tk.Entry(bar, bg=BG_INPUT, fg=FG, insertbackground=FG,
                              font=("Ubuntu", 12), relief="flat")
        self.entry.pack(side="left", fill="x", expand=True, ipady=8, padx=(0, 8))
        self.entry.bind("<Return>", lambda _e: self.send())
        self.entry.focus_set()

        self.mic_btn = tk.Button(bar, text="  Konus  ", command=self.listen,
                                 bg=BG_INPUT, fg=FG, activebackground=ACCENT,
                                 relief="flat", font=("Ubuntu", 11), cursor="hand2")
        self.mic_btn.pack(side="left", padx=(0, 8), ipady=4)

        self.send_btn = tk.Button(bar, text="  Gonder  ", command=self.send,
                                  bg=ACCENT, fg=BG, activebackground=FG,
                                  relief="flat", font=("Ubuntu", 11, "bold"), cursor="hand2")
        self.send_btn.pack(side="left", ipady=4)

        self.always_btn = tk.Button(bar, text="  Surekli dinle  ",
                                    command=self.toggle_always, bg=BG_INPUT, fg=FG,
                                    activebackground=ACCENT, relief="flat",
                                    font=("Ubuntu", 11), cursor="hand2")
        self.always_btn.pack(side="left", padx=(0, 8), ipady=4)

        self.web_on = tk.BooleanVar(value=core.WEB_SEARCH)
        self.tts_on = tk.BooleanVar(value=True)
        tk.Checkbutton(foot, text="Sesli yanit", variable=self.tts_on, bg=BG, fg=MUTED,
                       selectcolor=BG_INPUT, activebackground=BG, activeforeground=FG,
                       font=("Ubuntu", 10), relief="flat",
                       highlightthickness=0).pack(side="left")
        tk.Checkbutton(foot, text="Internet", variable=self.web_on, bg=BG, fg=MUTED,
                       selectcolor=BG_INPUT, activebackground=BG, activeforeground=FG,
                       font=("Ubuntu", 10), relief="flat",
                       highlightthickness=0).pack(side="left", padx=(12, 0))
        tk.Button(foot, text="Sohbeti temizle", command=self.clear, bg=BG, fg=MUTED,
                  activebackground=BG, activeforeground=FG, relief="flat",
                  font=("Ubuntu", 10), cursor="hand2").pack(side="left", padx=12)

        self.status = tk.Label(foot, text="", bg=BG, fg=MUTED, font=("Ubuntu", 10))
        self.status.pack(side="right")

        # sohbet alani en son: kalan tum bosluğu alir, kontrolleri itmez
        self.chat.pack(side="top", fill="both", expand=True, padx=10, pady=(10, 6))

    # ------------------------------------------------------------- yazma islemleri
    def _append(self, text: str, tag: str = "body") -> None:
        self.chat.configure(state="normal")
        self.chat.insert("end", text, tag)
        self.chat.see("end")
        self.chat.configure(state="disabled")

    def _cevabi_temizle(self) -> None:
        """Dusunce oldugu anlasilan metni ekrandan siler."""
        if self.cevap_baslangici is None:
            return
        self.chat.configure(state="normal")
        self.chat.delete(self.cevap_baslangici, "end-1c")
        self.chat.see("end")
        self.chat.configure(state="disabled")

    def _say_system(self, text: str, error: bool = False) -> None:
        self._append(f"{text}\n\n", "err" if error else "sys")

    def _set_busy(self, busy: bool, status: str = "", mic_active: bool = False) -> None:
        """mic_active: kayit suruyor, mikrofon dugmesi 'Bitir' olarak acik kalir."""
        self.busy = busy
        state = "disabled" if busy else "normal"
        self.entry.configure(state=state)
        self.send_btn.configure(state=state)
        self.mic_btn.configure(state="normal" if (mic_active or not busy) else "disabled",
                               text="  Bitir  " if mic_active else "  Konus  ",
                               bg=ERR_COLOR if mic_active else BG_INPUT,
                               fg=BG if mic_active else FG)
        self.status.configure(text=status)
        if not busy:
            self.entry.focus_set()

    def clear(self) -> None:
        if self.busy:
            return
        self.messages = [{"role": "system",
                          "content": core.build_system_prompt(self.web_on.get())}]
        self.chat.configure(state="normal")
        self.chat.delete("1.0", "end")
        self.chat.configure(state="disabled")
        self._say_system("Sohbet temizlendi.")

    # --------------------------------------------------------------- olay dongusu
    def _drain(self) -> None:
        """Is parcaciklarindan gelen olaylari arayuze isler."""
        try:
            while True:
                kind, payload = self.events.get_nowait()
                if kind == "token":
                    self._append(payload)
                elif kind == "status":
                    self.status.configure(text=payload)
                elif kind == "transcribed":
                    self._set_busy(True, "yaziya cevriliyor...")
                elif kind == "wait":
                    if self.wait_since is None:
                        self.wait_since = time.monotonic()
                    self.wait_label = payload
                elif kind == "wait_done":
                    self.wait_since = None
                    self.status.configure(text="")
                elif kind == "sys":
                    self._say_system(payload)
                elif kind == "always_off":
                    self.always_on.clear()
                    self.always_btn.configure(text="  Surekli dinle  ",
                                              bg=BG_INPUT, fg=FG)
                    self._set_busy(False)
                elif kind == "tool":
                    self._append(f"\n[ {payload} ]\n", "sys")
                    # sonraki turun dusuncesi silinirken bu satir korunsun
                    self.cevap_baslangici = self.chat.index("end-1c")
                elif kind == "recording":
                    self._set_busy(True, "dinliyorum, konusun...", mic_active=True)
                elif kind == "bot":
                    self._append(f"{core.NAME}\n", "bot")
                    self.cevap_baslangici = self.chat.index("end-1c")
                elif kind == "discard":
                    self._cevabi_temizle()
                elif kind == "user":
                    self._append("Sen\n", "user")
                    self._append(f"{payload}\n\n")
                elif kind == "error":
                    self._append(f"\n{payload}\n\n", "err")
                elif kind == "done":
                    self.wait_since = None
                    self._append("\n\n")
                    self._set_busy(False)
                    if self.always_on.is_set():
                        self.mic_btn.configure(state="disabled")
                elif kind == "idle":
                    self.wait_since = None
                    self._set_busy(False)
        except queue.Empty:
            pass
        if self.wait_since is not None:
            gecen = time.monotonic() - self.wait_since
            self.status.configure(text=f"{self.wait_label}... {gecen:.0f} sn")
        self.root.after(60, self._drain)

    # ------------------------------------------------------------------ eylemler
    def send(self) -> None:
        if self.busy:
            return
        text = self.entry.get().strip()
        if not text:
            return
        self.entry.delete(0, "end")
        self._append("Sen\n", "user")
        self._append(f"{text}\n\n")
        self._ask(text)

    def _ask(self, text: str) -> None:
        self._set_busy(True, "dusunuyor...")
        self.messages.append({"role": "user", "content": text})
        self.events.put(("bot", None))
        threading.Thread(target=self._worker_ask, daemon=True).start()

    def _on_token(self, token: str) -> None:
        """Ilk gercek token gelince bekleme sayacini durdurur."""
        self.events.put(("wait_done", None))
        self.events.put(("token", token))

    def _on_level(self, level: float, threshold: float, elapsed: float,
                  started: bool) -> None:
        """Kayit sirasinda ses seviyesini durum satirinda gosterir."""
        dolu = min(8, int((level / threshold) * 4)) if threshold > 0 else 0
        cubuk = "|" * dolu + "." * (8 - dolu)
        durum = "konusuyorsunuz" if started else "sessizlik bekleniyor"
        self.events.put(("status",
                         f"dinliyorum {cubuk} {durum} - {elapsed:.0f}sn "
                         f"(bitirmek icin Bitir)"))

    def toggle_always(self) -> None:
        """Uyandirma sozcugu ile surekli dinlemeyi acar/kapatir."""
        if self.always_on.is_set():
            self.always_on.clear()
            self.stop_flag.set()
            self.status.configure(text="dinleme durduruluyor...")
            return
        if self.busy:
            return
        self.always_on.set()
        self.always_btn.configure(text="  Dinlemeyi durdur  ", bg=ERR_COLOR, fg=BG)
        self.mic_btn.configure(state="disabled")
        threading.Thread(target=self._worker_always, daemon=True).start()

    def _worker_always(self) -> None:
        """Uyandirma sozcugu bekler, cevaptan sonra kisa sure sohbeti surdurur."""
        uyandirma = core.WAKE_WORDS[0].title() if core.WAKE_WORDS else core.NAME
        if not self._ensure_listener():
            self.events.put(("always_off", None))
            return
        self._say_ready(uyandirma)
        takip = False       # True: uyandirma sozcugu gerekmeyen kisa pencere

        while self.always_on.is_set():
            if takip:
                # Araya girildiyse kullanici zaten konusuyor, ortam olcumu yapma
                self.events.put(("status", "devam edebilirsiniz..."))
                komut = self._listen_once(max_seconds=core.FOLLOWUP_SECONDS,
                                          calibrate=not self.last_barge)
                self.last_barge = False
                if not komut:
                    takip = False
                    continue
            else:
                self.events.put(("status", f"'{uyandirma}' demenizi bekliyorum..."))
                metin = self._listen_once()
                if not self.always_on.is_set():
                    break
                if not metin:
                    continue
                uyandi, komut = core.wake_match(metin)
                if not uyandi:
                    continue
                if not komut:
                    self.events.put(("status", "efendim? sizi dinliyorum..."))
                    self._speak("Efendim?")
                    komut = self._listen_once()
                    if not komut or not self.always_on.is_set():
                        continue

            self.events.put(("user", komut))
            self.messages.append({"role": "user", "content": komut})
            self.events.put(("bot", None))
            self._stream_reply()
            takip = True

        self.events.put(("always_off", None))

    def _speak(self, text: str) -> bool:
        """Konusur. Kullanici araya girerse konusmayi keser ve True doner."""
        if self.speaker is None or not self.tts_on.get() or not text.strip():
            return False
        araya_girilebilir = (core.BARGE and self.listener is not None
                             and self.always_on.is_set())
        if not araya_girilebilir:
            self.speaker.say(text)
            return False

        kesildi, bitti = threading.Event(), threading.Event()

        def izle():
            try:
                if self.listener.wait_for_speech(should_stop=bitti.is_set):
                    kesildi.set()
            except Exception:
                pass  # mikrofon izlenemiyorsa konusma normal sekilde bitsin

        threading.Thread(target=izle, daemon=True).start()
        try:
            self.speaker.say(text, should_stop=kesildi.is_set)
        finally:
            bitti.set()
        if kesildi.is_set():
            self.events.put(("sys", "(araya girdiniz, sizi dinliyorum)"))
        return kesildi.is_set()

    def _ensure_listener(self) -> bool:
        if self.listener is not None:
            return True
        self.events.put(("status", f"ses tanima modeli yukleniyor ({core.WHISPER_MODEL})..."))
        try:
            self.listener = core.Listener()
            return True
        except Exception as exc:
            self.events.put(("error", f"Mikrofon baslatilamadi: {exc}"))
            return False

    def _say_ready(self, uyandirma: str) -> None:
        self.events.put(("sys", f"Surekli dinleme acik. '{uyandirma}' diye seslenip "
                                f"talimatinizi soyleyin."))

    def _listen_once(self, max_seconds: float = None, calibrate: bool = True) -> str:
        """Surekli dinleme dongusu icin tek bir konusma yakalar."""
        self.stop_flag.clear()
        try:
            return self.listener.listen(
                should_stop=lambda: not self.always_on.is_set(),
                max_seconds=max_seconds, calibrate=calibrate)
        except Exception as exc:
            self.events.put(("error", f"Ses cozumlenemedi: {exc}"))
            self.always_on.clear()
            return ""

    def _worker_ask(self) -> None:
        self._stream_reply()

    def _stream_reply(self) -> None:
        """Ollama yanitini akitir; hem yazili hem sesli girdide ayni yol."""
        self.events.put(("wait", "dusunuyor"))
        try:
            reply = core.chat_stream(
                self.messages,
                self._on_token,
                on_tool=lambda ad, args: self.events.put(("tool", core.arac_metni(ad, args))),
                web_enabled=self.web_on.get(),
                on_think=lambda _t: self.events.put(("wait", "akil yurutuyor")),
                on_discard=lambda: self.events.put(("discard", None)),
            )
        except core.requests.exceptions.ConnectionError:
            self.messages.pop()
            self.events.put(("error", f"Ollama'ya baglanilamadi ({core.OLLAMA_HOST}).\n"
                                      "Terminalde:  sudo systemctl start ollama"))
            self.events.put(("idle", None))
            return
        except Exception as exc:
            self.messages.pop()
            self.events.put(("error", f"Hata: {exc}"))
            self.events.put(("idle", None))
            return
        self.messages.append({"role": "assistant", "content": reply})
        self.events.put(("done", None))
        self.last_barge = False
        if self.tts_on.get() and reply.strip():
            self.events.put(("status", "seslendiriliyor..."))
            self.last_barge = self._speak(reply)
            self.events.put(("status", ""))

    def listen(self) -> None:
        """Ilk basista dinlemeye baslar, ikinci basista kaydi bitirir."""
        if self.recording:
            self.stop_flag.set()
            self.status.configure(text="kayit bitiriliyor...")
            return
        if self.busy:
            return
        self.stop_flag.clear()
        self._set_busy(True, "mikrofon hazirlaniyor...")
        threading.Thread(target=self._worker_listen, daemon=True).start()

    def _worker_listen(self) -> None:
        if self.listener is None:
            self.events.put(("status", f"ses tanima modeli yukleniyor ({core.WHISPER_MODEL})..."))
            try:
                self.listener = core.Listener()
            except Exception as exc:
                self.events.put(("error", f"Mikrofon baslatilamadi: {exc}"))
                self.events.put(("idle", None))
                return
        self.recording = True
        self.events.put(("recording", None))
        try:
            text = self.listener.listen(should_stop=self.stop_flag.is_set,
                                        on_level=self._on_level)
        except Exception as exc:
            self.recording = False
            self.events.put(("error", f"Ses cozumlenemedi: {exc}"))
            self.events.put(("idle", None))
            return
        finally:
            self.recording = False
            self.events.put(("transcribed", None))
        if not text:
            self.events.put(("error", "Ses algilanmadi, tekrar deneyin."))
            self.events.put(("idle", None))
            return
        self.events.put(("user", text))
        self.messages.append({"role": "user", "content": text})
        self.events.put(("bot", None))
        self.events.put(("status", "dusunuyor..."))
        self._stream_reply()


def main() -> int:
    root = tk.Tk()
    JarvisApp(root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
