#!/usr/bin/env python3
"""Atlas'in gercek yetenekleri.

Model, cevap uretirken bu araclari cagirabilir. Her arac iki parcadan olusur:
modele sunulan tanim (ad, aciklama, parametreler) ve calistiran islev.
Islevler her zaman kullaniciya okunabilir Turkce metin dondurur; hata
durumunda da metin doner, istisna firlatmaz - boylece sohbet hic kesilmez.
"""
from __future__ import annotations

import ast
import json
import operator
import os
import shutil
import subprocess
import threading
from datetime import datetime, timedelta
from pathlib import Path

ARACLAR: dict = {}

VERI_DIZINI = Path(os.getenv("JARVIS_DATA_DIR",
                             Path.home() / ".local/share/atlas"))
NOT_DOSYASI = VERI_DIZINI / "notlar.json"

GUNLER = ["Pazartesi", "Sali", "Carsamba", "Persembe", "Cuma", "Cumartesi", "Pazar"]
AYLAR = ["Ocak", "Subat", "Mart", "Nisan", "Mayis", "Haziran",
         "Temmuz", "Agustos", "Eylul", "Ekim", "Kasim", "Aralik"]


def arac(ad: str, aciklama: str, parametreler: dict = None, gerekli: list = None):
    """Bir islevi modele sunulacak arac olarak kaydeder."""
    def sarmala(islev):
        ARACLAR[ad] = {
            "islev": islev,
            "spec": {
                "type": "function",
                "function": {
                    "name": ad,
                    "description": aciklama,
                    "parameters": {
                        "type": "object",
                        "properties": parametreler or {},
                        "required": gerekli or [],
                    },
                },
            },
        }
        return islev
    return sarmala


def specs(adlar: list = None) -> list:
    """Ollama'ya gonderilecek arac tanimlari."""
    if adlar is None:
        adlar = list(ARACLAR)
    return [ARACLAR[a]["spec"] for a in adlar if a in ARACLAR]


def calistir(ad: str, args: dict) -> str:
    """Araci calistirir; her kosulda metin doner."""
    kayit = ARACLAR.get(ad)
    if kayit is None:
        return f"HATA: '{ad}' adinda bir arac yok."
    try:
        return kayit["islev"](**(args or {}))
    except TypeError as exc:
        return f"HATA: '{ad}' araci yanlis parametrelerle cagrildi ({exc})."
    except Exception as exc:
        return f"HATA: '{ad}' calistirilamadi ({exc})."


# --------------------------------------------------------------- saat ve tarih
@arac("saat_tarih", "Su anki saati ve tarihi verir. Kullanici saati, gunu, tarihi "
                    "ya da hangi gun oldugunu sordugunda kullan.")
def saat_tarih() -> str:
    simdi = datetime.now()
    return (f"{simdi.day} {AYLAR[simdi.month - 1]} {simdi.year}, "
            f"{GUNLER[simdi.weekday()]}, saat {simdi:%H:%M}.")


# ------------------------------------------------------------------- hesaplama
_ISLEMLER = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod, ast.Pow: operator.pow,
    ast.USub: operator.neg, ast.UAdd: operator.pos,
}


def _hesapla_dugum(dugum):
    if isinstance(dugum, ast.Constant):
        if isinstance(dugum.value, (int, float)):
            return dugum.value
        raise ValueError("sadece sayilar")
    if isinstance(dugum, ast.BinOp) and type(dugum.op) in _ISLEMLER:
        sol, sag = _hesapla_dugum(dugum.left), _hesapla_dugum(dugum.right)
        # cok buyuk us hesaplari sistemi kilitleyebilir
        if isinstance(dugum.op, ast.Pow) and (abs(sag) > 1000 or abs(sol) > 10 ** 9):
            raise ValueError("sonuc cok buyuk")
        return _ISLEMLER[type(dugum.op)](sol, sag)
    if isinstance(dugum, ast.UnaryOp) and type(dugum.op) in _ISLEMLER:
        return _ISLEMLER[type(dugum.op)](_hesapla_dugum(dugum.operand))
    raise ValueError("desteklenmeyen islem")


@arac("hesapla", "Matematik islemi yapar. Toplama, cikarma, carpma, bolme, us alma. "
                 "Ornek ifade: (1250 * 18) / 100",
      {"ifade": {"type": "string", "description": "Hesaplanacak matematik ifadesi"}},
      ["ifade"])
def hesapla(ifade: str) -> str:
    temiz = (ifade or "").replace(",", ".").replace("x", "*").replace("^", "**")
    if len(temiz) > 200:
        return "HATA: ifade cok uzun."
    try:
        agac = ast.parse(temiz, mode="eval")
        sonuc = _hesapla_dugum(agac.body)
    except ZeroDivisionError:
        return "Sifira bolme yapilamaz."
    except ValueError as exc:
        if "cok buyuk" in str(exc):
            return "HATA: sonuc hesaplanamayacak kadar buyuk."
        return f"HATA: '{ifade}' bir matematik ifadesi olarak anlasilamadi."
    except Exception:
        return f"HATA: '{ifade}' bir matematik ifadesi olarak anlasilamadi."
    if isinstance(sonuc, float) and sonuc.is_integer():
        sonuc = int(sonuc)
    elif isinstance(sonuc, float):
        sonuc = round(sonuc, 6)
    return f"{ifade} = {sonuc}"


# --------------------------------------------------------------- sistem bilgisi
def _oku(yol: str) -> str:
    try:
        return Path(yol).read_text().strip()
    except Exception:
        return ""


@arac("sistem_bilgisi", "Bilgisayarin durumunu verir: bellek kullanimi, disk doluluk "
                        "orani, calisma suresi, pil durumu. Kullanici bilgisayarin "
                        "durumunu sordugunda kullan.")
def sistem_bilgisi() -> str:
    satirlar = []

    meminfo = _oku("/proc/meminfo")
    if meminfo:
        degerler = {}
        for satir in meminfo.splitlines():
            parca = satir.split(":")
            if len(parca) == 2:
                degerler[parca[0]] = int(parca[1].strip().split()[0])
        toplam = degerler.get("MemTotal", 0) / 1048576
        bos = degerler.get("MemAvailable", 0) / 1048576
        if toplam:
            satirlar.append(f"Bellek: {toplam - bos:.1f} GB kullanimda, "
                            f"{toplam:.1f} GB toplam")

    try:
        kullanim = shutil.disk_usage("/")
        satirlar.append(f"Disk: {kullanim.used / 2**30:.0f} GB dolu, "
                        f"{kullanim.free / 2**30:.0f} GB bos")
    except Exception:
        pass

    uptime = _oku("/proc/uptime")
    if uptime:
        saniye = float(uptime.split()[0])
        satirlar.append(f"Calisma suresi: {int(saniye // 3600)} saat "
                        f"{int(saniye % 3600 // 60)} dakika")

    pil_dizini = Path("/sys/class/power_supply")
    if pil_dizini.exists():
        for pil in sorted(pil_dizini.glob("BAT*")):
            yuzde = _oku(str(pil / "capacity"))
            durum = _oku(str(pil / "status"))
            if yuzde:
                cevrim = {"Charging": "sarj oluyor", "Discharging": "sarjta degil",
                          "Full": "dolu", "Not charging": "sarj olmuyor"}
                satirlar.append(f"Pil: %{yuzde} ({cevrim.get(durum, durum)})")
            break

    return "\n".join(satirlar) if satirlar else "Sistem bilgisi okunamadi."


# ------------------------------------------------------------------------ notlar
def _notlari_oku() -> list:
    try:
        return json.loads(NOT_DOSYASI.read_text())
    except Exception:
        return []


def _notlari_yaz(notlar: list) -> None:
    VERI_DIZINI.mkdir(parents=True, exist_ok=True)
    NOT_DOSYASI.write_text(json.dumps(notlar, ensure_ascii=False, indent=2))


@arac("not_ekle", "Kullanicinin soyledigi bir seyi not olarak kaydeder. "
                  "'sunu not al', 'aklinda tut' gibi isteklerde kullan.",
      {"metin": {"type": "string", "description": "Kaydedilecek not"}}, ["metin"])
def not_ekle(metin: str) -> str:
    metin = (metin or "").strip()
    if not metin:
        return "HATA: bos not kaydedilmez."
    notlar = _notlari_oku()
    notlar.append({"metin": metin, "tarih": datetime.now().isoformat(timespec="minutes")})
    _notlari_yaz(notlar)
    return f"Not kaydedildi: {metin}"


@arac("notlari_getir", "Daha once kaydedilmis notlari listeler.")
def notlari_getir() -> str:
    notlar = _notlari_oku()
    if not notlar:
        return "Kayitli not yok."
    satirlar = []
    for i, n in enumerate(notlar[-20:], 1):
        try:
            t = datetime.fromisoformat(n["tarih"])
            damga = f"{t.day} {AYLAR[t.month - 1]} {t:%H:%M}"
        except Exception:
            damga = ""
        satirlar.append(f"{i}. {n['metin']} ({damga})")
    return "\n".join(satirlar)


@arac("notlari_sil", "Kayitli tum notlari siler. Kullanici acikca istediginde kullan.")
def notlari_sil() -> str:
    adet = len(_notlari_oku())
    _notlari_yaz([])
    return f"{adet} not silindi."


# ------------------------------------------------------------------ hatirlatici
_ZAMANLAYICILAR = []


def _bildir(baslik: str, metin: str) -> None:
    if shutil.which("notify-send"):
        subprocess.run(["notify-send", baslik, metin], check=False)


@arac("hatirlatici_kur", "Belirtilen dakika sonra masaustu bildirimi gosterir.",
      {"dakika": {"type": "number", "description": "Kac dakika sonra"},
       "mesaj": {"type": "string", "description": "Hatirlatilacak metin"}},
      ["dakika", "mesaj"])
def hatirlatici_kur(dakika: float, mesaj: str) -> str:
    try:
        dakika = float(dakika)
    except (TypeError, ValueError):
        return "HATA: sure sayi olmali."
    if dakika <= 0 or dakika > 24 * 60:
        return "HATA: sure 1 dakika ile 24 saat arasinda olmali."
    mesaj = (mesaj or "").strip() or "Hatirlatma"

    zamanlayici = threading.Timer(dakika * 60, _bildir, args=("Atlas", mesaj))
    zamanlayici.daemon = True
    zamanlayici.start()
    _ZAMANLAYICILAR.append(zamanlayici)
    ne_zaman = (datetime.now() + timedelta(minutes=dakika)).strftime("%H:%M")
    return f"Tamam, saat {ne_zaman} icin hatirlatici kuruldu: {mesaj}"


# --------------------------------------------------------------- uygulama acma
# Guvenlik: model rastgele komut calistiramaz, yalnizca bu listedekiler acilir.
UYGULAMALAR = {
    "tarayici": ["xdg-open", "https://www.google.com"],
    "hesap makinesi": ["gnome-calculator"],
    "dosyalar": ["xdg-open", str(Path.home())],
    "terminal": ["gnome-terminal"],
    "metin editoru": ["gnome-text-editor"],
    "ayarlar": ["gnome-control-center"],
    "sistem izleyici": ["gnome-system-monitor"],
}


@arac("uygulama_ac", "Bilgisayarda bir uygulama acar. Sadece su isimler gecerlidir: "
                     + ", ".join(UYGULAMALAR),
      {"uygulama": {"type": "string", "description": "Acilacak uygulamanin adi"}},
      ["uygulama"])
def uygulama_ac(uygulama: str) -> str:
    ad = (uygulama or "").strip().lower()
    komut = UYGULAMALAR.get(ad)
    if komut is None:
        for anahtar in UYGULAMALAR:
            if anahtar in ad or ad in anahtar:
                komut, ad = UYGULAMALAR[anahtar], anahtar
                break
    if komut is None:
        return (f"HATA: '{uygulama}' acilamaz. Acabildiklerim: "
                + ", ".join(UYGULAMALAR) + ".")
    if not shutil.which(komut[0]):
        return f"HATA: {ad} bu sistemde kurulu degil."
    try:
        subprocess.Popen(komut, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as exc:
        return f"HATA: {ad} acilamadi ({exc})."
    return f"{ad.capitalize()} acildi."
