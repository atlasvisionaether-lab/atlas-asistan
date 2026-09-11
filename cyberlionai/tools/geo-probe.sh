#!/usr/bin/env bash
#
# İki soruyu ölçer:
#   1. Adı geçen tehdit beslemeleri anahtarsız erişilebiliyor mu, ülke taşıyor mu?
#   2. IP→ülke çözümü anahtarsız yapılabilir mi? (RIR delegasyon dosyaları)
#
# Neden gerekiyor: "100+ ülke" isteğinin önündeki engel besleme sayısı değil,
# beslemelerin ülke taşımaması. urlhaus'ta ~3900 kayıt var ama ülkesi yok.
# IP→ülke çözülebilirse mevcut beslemeler zaten yüzlerce ülkeye yayılır.
#
# Salt-okunur. Secret kullanmaz. Hiçbir yere yazmaz.

set -uo pipefail
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
UA="CyberLionAI-Probe/1.0 (+https://www.cyberlionai.com)"
T=25

head1() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
note() { printf '   %s\n' "$1"; }

# --------------------------------------------------------------------------
head1 "1. Adı geçen beslemeler — anahtarsız erişim ve ülke alanı"

dene() {  # dene <ad> <url> <aciklama>
  local ad="$1" url="$2" not="$3" f="$WORK/$1"
  local kod
  kod=$(curl -sSL -m "$T" -A "$UA" -o "$f" -w '%{http_code}' "$url" 2>/dev/null) || kod=000
  printf '\n   \033[1m%s\033[0m  HTTP %s  %s bayt\n' "$ad" "$kod" "$(wc -c < "$f" 2>/dev/null || echo 0)"
  note "$not"
  case "$kod" in
    200)
      if jq -e . "$f" >/dev/null 2>&1; then
        note "JSON. ulke alani aranıyor:"
        jq -r '[paths(scalars) | map(tostring) | join(".")] | map(select(test("country|cc$|geo";"i"))) | unique | .[0:6] | if length==0 then "  ULKE ALANI YOK" else "  " + join(", ") end' "$f" 2>/dev/null | head -3
      else
        note "JSON degil. ilk satir: $(head -c 120 "$f" | tr -d '\n')"
      fi ;;
    401|403) note "\033[31mANAHTAR GEREKIYOR\033[0m — kayit ve API anahtari olmadan kullanilamaz." ;;
    404) note "\033[31mADRES YOK\033[0m — bu uc bu bicimde mevcut degil." ;;
    000) note "\033[31mULASILAMADI\033[0m" ;;
    *)   note "beklenmeyen durum; ilk satir: $(head -c 120 "$f" | tr -d '\n')" ;;
  esac
}

dene abuseipdb "https://api.abuseipdb.com/api/v2/blacklist" "AbuseIPDB kara liste"
dene greynoise "https://api.greynoise.io/v3/community/8.8.8.8" "GreyNoise Community (tek IP sorgusu)"
dene otx       "https://otx.alienvault.com/api/v1/pulses/subscribed?limit=1" "AlienVault OTX"
dene phishtank "http://data.phishtank.com/data/online-valid.json" "PhishTank indirme"
dene circl     "https://www.circl.lu/pdns/query/8.8.8.8" "CIRCL Passive DNS"

# --------------------------------------------------------------------------
head1 "2. IP→ülke — RIR delegasyon dosyaları (kamu malı, anahtarsız)"
note "Bes bolgesel kayit kurulusu, IP araligi -> ulke kodu esleme yayinliyor."
note "Anahtar gerekmiyor, kullanim serbest. Asil kilit bu."

TOPLAM=0
for rir in \
  "ripencc|https://ftp.ripe.net/pub/stats/ripencc/delegated-ripencc-latest" \
  "arin|https://ftp.arin.net/pub/stats/arin/delegated-arin-extended-latest" \
  "apnic|https://ftp.apnic.net/stats/apnic/delegated-apnic-latest" \
  "lacnic|https://ftp.lacnic.net/pub/stats/lacnic/delegated-lacnic-latest" \
  "afrinic|https://ftp.afrinic.net/stats/afrinic/delegated-afrinic-latest"
do
  ad="${rir%%|*}"; url="${rir#*|}"; f="$WORK/rir-$ad"
  kod=$(curl -sSL -m 90 -A "$UA" -o "$f" -w '%{http_code}' "$url" 2>/dev/null) || kod=000
  if [ "$kod" = "200" ]; then
    n=$(awk -F'|' '$3=="ipv4" && $7!="reserved" && $7!="available" && $2!="" {c++} END{print c+0}' "$f")
    u=$(awk -F'|' '$3=="ipv4" && $2!="" {print $2}' "$f" | sort -u | wc -l)
    TOPLAM=$((TOPLAM + n))
    printf '   %-9s HTTP %s  %8s bayt  %7s IPv4 araligi  %3s ulke\n' "$ad" "$kod" "$(wc -c < "$f")" "$n" "$u"
  else
    printf '   %-9s \033[31mHTTP %s — alinamadi\033[0m\n' "$ad" "$kod"
  fi
done

head1 "3. Birleşik tablo — ölçüm"
cat "$WORK"/rir-* 2>/dev/null | awk -F'|' '$3=="ipv4" && $2!="" && $7!="reserved" && $7!="available"' > "$WORK/tum" || true
SATIR=$(wc -l < "$WORK/tum" 2>/dev/null || echo 0)
ULKE=$(awk -F'|' '{print $2}' "$WORK/tum" 2>/dev/null | sort -u | wc -l)
note "toplam IPv4 araligi : $SATIR"
note "kapsanan ulke sayisi: $ULKE"
note "ornek kayit         : $(head -1 "$WORK/tum" 2>/dev/null)"

# Gercek boyut: baslangic, bitis ve ulke kodundan olusan sikistirilmis tablo.
awk -F'|' '{printf "%s %s %s\n", $4, $5, $2}' "$WORK/tum" 2>/dev/null > "$WORK/tablo" || true
note "ham tablo boyutu    : $(wc -c < "$WORK/tablo" 2>/dev/null || echo 0) bayt"
gzip -9 -c "$WORK/tablo" 2>/dev/null | wc -c | xargs -I{} echo "   gzip'li boyut       : {} bayt"

head1 "Not"
note "Bu betik yalnizca olcum yapar. Kullanim sartlari ayrica degerlendirilir."
note "RIR delegasyon dosyalari kamu malidir ve serbestce kullanilabilir."
