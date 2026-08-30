#!/usr/bin/env python3
"""Atlas'in beyni: Ollama (yerel) ya da Claude API (bulut).

Iki arka uc da ayni arayuzu sunar:

    beyin.sohbet(gecmis, on_token, on_tool=..., web_acik=...) -> str

`gecmis` notr bicimdedir: [{"role": "system"|"user"|"assistant", "content": str}].
Arac cagrilari her arka ucun kendi bicimine burada cevrilir, boylece arayuz
ve araclar hangi beynin calistigini bilmek zorunda kalmaz.
"""
from __future__ import annotations

import json
import os

import requests

import jarvis_tools as tools

# ----------------------------------------------------------------- ayarlar
BEYIN = os.getenv("JARVIS_BEYIN", "ollama").strip().lower()
CLAUDE_MODEL = os.getenv("JARVIS_CLAUDE_MODEL", "claude-opus-5")
CLAUDE_MAX_TOKENS = int(os.getenv("JARVIS_CLAUDE_MAX_TOKENS", "4000"))


def arac_adlari(web: bool) -> list:
    """Internet kapaliyken arama araci modele hic sunulmaz."""
    return [ad for ad in tools.ARACLAR if web or ad != "internette_ara"]


# ------------------------------------------------------------------ Claude
class ClaudeBeyin:
    """Anthropic Claude API. Akan yanit + arac cagri dongusu."""

    def __init__(self, model: str = None, api_key: str = None):
        import anthropic  # yalnizca bu beyin secilince gerekir

        self.anthropic = anthropic
        self.model = model or CLAUDE_MODEL
        self.client = (anthropic.Anthropic(api_key=api_key) if api_key
                       else anthropic.Anthropic())

    # --- arac tanimlarini Claude bicimine cevir
    def _arac_tanimlari(self, web: bool) -> list:
        tanimlar = []
        for ad in arac_adlari(web):
            islev = tools.ARACLAR[ad]["spec"]["function"]
            tanimlar.append({
                "name": islev["name"],
                "description": islev["description"],
                "input_schema": islev["parameters"],
            })
        return tanimlar

    # --- notr gecmisi Claude mesajlarina cevir
    @staticmethod
    def _mesajlar(gecmis: list) -> "tuple[str, list]":
        sistem = ""
        mesajlar = []
        for m in gecmis:
            rol = m.get("role")
            icerik = m.get("content")
            if rol == "system":
                sistem = str(icerik or "")
            elif rol in ("user", "assistant") and isinstance(icerik, str) and icerik.strip():
                # Claude ardisik ayni rolu kabul etmez; birlestir
                if mesajlar and mesajlar[-1]["role"] == rol:
                    mesajlar[-1]["content"] += "\n" + icerik
                else:
                    mesajlar.append({"role": rol, "content": icerik})
        # Ilk mesaj kullanicidan olmali
        while mesajlar and mesajlar[0]["role"] != "user":
            mesajlar.pop(0)
        return sistem, mesajlar

    def sohbet(self, gecmis: list, on_token, on_tool=None, web_acik: bool = True,
               on_think=None, max_tur: int = 6) -> str:
        sistem, mesajlar = self._mesajlar(gecmis)
        if not mesajlar:
            return ""
        arac_tanimlari = self._arac_tanimlari(web_acik)
        cevap_parcalari = []

        for _ in range(max_tur):
            istek = dict(
                model=self.model,
                max_tokens=CLAUDE_MAX_TOKENS,
                messages=mesajlar,
                tools=arac_tanimlari,
                thinking={"type": "adaptive"},
                # Guvenlik siniflandiricisi bir istegi reddederse sunucu
                # tarafinda baska bir modele duser; sohbet kesilmez.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
            if sistem:
                istek["system"] = sistem

            with self.client.beta.messages.stream(**istek) as akis:
                for olay in akis:
                    if olay.type != "content_block_delta":
                        continue
                    if olay.delta.type == "text_delta":
                        cevap_parcalari.append(olay.delta.text)
                        on_token(olay.delta.text)
                    elif olay.delta.type == "thinking_delta" and on_think is not None:
                        on_think(olay.delta.thinking)
                yanit = akis.get_final_message()

            if yanit.stop_reason == "refusal":
                return ("Bu isteği güvenlik nedeniyle yanıtlayamıyorum. "
                        "Başka bir şekilde sorabilir misiniz?")
            if yanit.stop_reason != "tool_use":
                break

            cagrilar = [b for b in yanit.content if b.type == "tool_use"]
            mesajlar.append({"role": "assistant", "content": yanit.content})
            sonuclar = []
            for cagri in cagrilar:
                if on_tool is not None:
                    on_tool(cagri.name, cagri.input or {})
                sonuclar.append({
                    "type": "tool_result",
                    "tool_use_id": cagri.id,
                    "content": tools.calistir(cagri.name, cagri.input or {}),
                })
            mesajlar.append({"role": "user", "content": sonuclar})

        return "".join(cevap_parcalari)
