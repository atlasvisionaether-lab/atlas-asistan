"""chunker.py sınaması — yalnızca standart kütüphane: `python3 test_chunker.py`."""

import chunker

passed, failed = 0, []


def check(name, cond):
    global passed
    if cond:
        passed += 1
    else:
        failed.append(name)


MD = """# Güzel Salon

![logo](images/logo.png)

## Fiyat Listesi

### Saç

| Hizmet | Fiyat |
|---|---|
| Kesim | 450 TL |
| Fön | 250 TL |

### Tırnak

<table><tr><td>Protez tırnak</td><td>900 TL</td></tr><tr><td>Kalıcı oje</td><td>400 TL</td></tr></table>

## İptal Politikası

Randevunuzu en geç 24 saat önce iptal edin.

Geç iptallerde kapora iade edilmez.
"""

c = chunker.chunk(MD)
headings = [x["heading"] for x in c]
check("başlık yolu üst başlıklarla", "Güzel Salon › Fiyat Listesi › Saç" in headings)
check("ikinci dal başlığı", "Güzel Salon › Fiyat Listesi › Tırnak" in headings)
check("üçüncü seviyeden ikinciye dönüş", "Güzel Salon › İptal Politikası" in headings)
check("görsel atıldı", all("![" not in x["content"] for x in c))
sac = next(x for x in c if x["heading"].endswith("Saç"))
check("markdown tablo bütün", "| Kesim | 450 TL |" in sac["content"] and "| Fön | 250 TL |" in sac["content"])
tir = next(x for x in c if x["heading"].endswith("Tırnak"))
check("HTML tablo bütün", tir["content"].startswith("<table") and "900 TL" in tir["content"] and "400 TL" in tir["content"])
iptal = next(x for x in c if x["heading"].endswith("İptal Politikası"))
check("kısa paragraflar aynı parçada", "24 saat" in iptal["content"] and "kapora" in iptal["content"])
check("sıra numarası", [x["index"] for x in c] == list(range(len(c))))
check("boş başlık bölümü (yalnız görsel) parça üretmez", "Güzel Salon" not in headings)

# Uzun bölüm: MAX_CHARS'ı aşmaz, satır ortasından bölünmez.
uzun = "## Hizmetler\n\n" + "\n".join("| Hizmet %d | %d TL |" % (i, 100 + i) for i in range(400))
cu = chunker.chunk(uzun)
check("uzun bölüm birden çok parça", len(cu) > 1)
check("hiçbir parça sınırı aşmıyor", all(len(x["content"]) <= chunker.MAX_CHARS for x in cu))
check("tablo satırı bölünmedi", all(line.startswith("| Hizmet") and line.endswith("TL |")
                                     for x in cu for line in x["content"].split("\n")))

# Tek dev satır (boşluklu): kelime sınırından.
dev = "## Not\n\n" + ("kelime " * 1200)
cd = chunker.chunk(dev)
check("dev satır bölündü", len(cd) > 1 and all(len(x["content"]) <= chunker.MAX_CHARS for x in cd))

check("boş belge", chunker.chunk("") == [])
check("başlıksız metin", chunker.chunk("Sadece bir paragraf.")[0]["heading"] == "")

if failed:
    print("chunker: %d KALDI, %d geçti" % (len(failed), passed))
    for f in failed:
        print("  ✗", f)
    raise SystemExit(1)
print("chunker: %d / %d geçti" % (passed, passed))
