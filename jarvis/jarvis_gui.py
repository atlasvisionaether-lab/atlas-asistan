#!/usr/bin/env python3
"""Jarvis masaustu penceresi (Tkinter).

Terminal yerine normal bir uygulama penceresi sunar: yazarak ya da
mikrofon dugmesiyle konusarak sohbet edilir. Model cagrilari ayri bir
is parcaciginda calisir, pencere donmaz.
"""
from __future__ import annotations

import queue
import threading
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

        self.tts_on = tk.BooleanVar(value=True)
        tk.Checkbutton(foot, text="Sesli yanit", variable=self.tts_on, bg=BG, fg=MUTED,
                       selectcolor=BG_INPUT, activebackground=BG, activeforeground=FG,
                       font=("Ubuntu", 10), relief="flat",
                       highlightthickness=0).pack(side="left")
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

    def _say_system(self, text: str, error: bool = False) -> None:
        self._append(f"{text}\n\n", "err" if error else "sys")

    def _set_busy(self, busy: bool, status: str = "") -> None:
        self.busy = busy
        state = "disabled" if busy else "normal"
        self.entry.configure(state=state)
        self.send_btn.configure(state=state)
        self.mic_btn.configure(state=state)
        self.status.configure(text=status)
        if not busy:
            self.entry.focus_set()

    def clear(self) -> None:
        if self.busy:
            return
        self.messages = [{"role": "system", "content": core.SYSTEM_PROMPT}]
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
                elif kind == "bot":
                    self._append(f"{core.NAME}\n", "bot")
                elif kind == "user":
                    self._append("Sen\n", "user")
                    self._append(f"{payload}\n\n")
                elif kind == "error":
                    self._append(f"\n{payload}\n\n", "err")
                elif kind == "done":
                    self._append("\n\n")
                    self._set_busy(False)
                elif kind == "idle":
                    self._set_busy(False)
        except queue.Empty:
            pass
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
        self._append(f"{core.NAME}\n", "bot")
        threading.Thread(target=self._worker_ask, daemon=True).start()

    def _worker_ask(self) -> None:
        self._stream_reply()

    def _stream_reply(self) -> None:
        """Ollama yanitini akitir; hem yazili hem sesli girdide ayni yol."""
        try:
            reply = core.chat_stream(self.messages,
                                     lambda t: self.events.put(("token", t)))
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
        if self.tts_on.get() and reply.strip():
            self.events.put(("status", "seslendiriliyor..."))
            self.speaker.say(reply)
            self.events.put(("status", ""))

    def listen(self) -> None:
        if self.busy:
            return
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
        self.events.put(("status", "dinliyorum, konusun..."))
        try:
            text = self.listener.listen()
        except Exception as exc:
            self.events.put(("error", f"Ses cozumlenemedi: {exc}"))
            self.events.put(("idle", None))
            return
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
