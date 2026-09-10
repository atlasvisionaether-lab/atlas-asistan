#!/usr/bin/env bash
#
# Açık tehdit beslemelerinin biçimini ölçer.
#
# Neden ayrı bir araç: besleme şemasını tahmin edip parser yazmak kırılgan.
# Bu betik gerçek yanıtı alır, alan adlarını ve örnek değerleri yazdırır;
# parser buna göre yazılır. Bir besleme biçim değiştirdiğinde de aynı betik
# bunu görünür kılar.
#
# Hiçbir secret kullanmaz, hiçbir şey yazmaz — yalnızca okur ve özetler.
# Geliştirme kutusundan çalışmaz (giden bağlantı kısıtlı); GitHub Actions
# koşucusunda çalıştırılır.

set -uo pipefail

TIMEOUT="${TIMEOUT:-25}"
UA='CyberLionAI-FeedProbe/1.0 (+https://cyberlionai.com)'

head1() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
note()  { printf '   %s\n' "$1"; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# probe AD URL BEKLENEN_TUR
probe() {
  local ad="$1" url="$2" tur="$3" f="$WORK/$1"
  head1 "$ad"
  note "adres: $url"

  local kod
  kod=$(curl -sSL -m "$TIMEOUT" -A "$UA" -o "$f" -w '%{http_code}' "$url" 2>"$WORK/err") || true

  if [ "$kod" != "200" ]; then
    note "DURUM: ${kod:-baglanti yok}  $(head -c 120 "$WORK/err" 2>/dev/null)"
    note "SONUC: KULLANILAMADI"
    return
  fi

  note "durum: 200   boyut: $(wc -c < "$f") bayt   tur: $(file -b --mime-type "$f")"

  if [ "$tur" = "json" ]; then
    if ! jq -e . "$f" >/dev/null 2>&1; then
      note "SONUC: 200 dondu ama gecerli JSON degil"
      note "ilk 200 bayt: $(head -c 200 "$f")"
      return
    fi
    # Dizi mi, nesne mi? Kayit sayisi ve alan adlari.
    local kok
    kok=$(jq -r 'type' "$f")
    note "JSON kok turu: $kok"
    case "$kok" in
      array)
        note "kayit sayisi: $(jq 'length' "$f")"
        note "alanlar: $(jq -r '[.[0] // {} | keys[]] | join(", ")' "$f")"
        note "ornek kayit:"
        jq -r '.[0] // {}' "$f" | sed 's/^/     /' | head -20
        # Ulke alani var mi? Harita icin kritik.
        for a in country country_code cc geo; do
          if jq -e --arg a "$a" '.[0] | has($a)' "$f" >/dev/null 2>&1; then
            note "ULKE ALANI: .$a  ornek: $(jq -r --arg a "$a" '.[0][$a]' "$f")"
            note "farkli ulke sayisi: $(jq -r --arg a "$a" '[.[][$a]] | unique | length' "$f")"
          fi
        done
        ;;
      object)
        note "ust duzey anahtarlar: $(jq -r 'keys | join(", ")' "$f" | head -c 300)"
        note "ornek:"
        jq -r 'to_entries | .[0].value' "$f" 2>/dev/null | sed 's/^/     /' | head -20
        ;;
    esac
  else
    note "satir sayisi: $(wc -l < "$f")"
    note "ilk 5 satir:"
    head -5 "$f" | sed 's/^/     /'
  fi
  note "SONUC: KULLANILABILIR"
}

echo "Acik tehdit beslemesi bicim olcumu"
echo "Zaman: $(date -u +'%Y-%m-%d %H:%M UTC')"

probe feodo    "https://feodotracker.abuse.ch/downloads/ipblocklist.json"  json
probe urlhaus  "https://urlhaus.abuse.ch/downloads/json_recent/"           json
probe torexit  "https://check.torproject.org/torbulkexitlist"              text

head1 "Not"
note "Bu betik yalnizca bicim olcer. Kullanim sartlari ayrica degerlendirilir:"
note "abuse.ch verileri atif sartiyla yeniden yayinlanabilir; Tor exit list acik."
note "Kapali/ticari tehdit haritalari (Kaspersky, Check Point, Fortinet, Radware)"
note "bu listede BILEREK yok - API'leri yok ve sartlari yeniden yayini yasakliyor."
