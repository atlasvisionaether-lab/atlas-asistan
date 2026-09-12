#!/usr/bin/env bash
#
# /api/worldmap'in toplam sayisini KAYNAK BAZINDA doker.
#
#   BASE=https://www.cyberlionai.com bash tools/worldmap-breakdown.sh
#
# NEDEN GEREKLI
#
# Haritadaki "toplam kayit" tek bir sayi olarak gorunuyor; hangi beslemeden ne
# kadar geldigi gorunmuyor. Sayi bir gecede 10 kat artinca "neden" sorusunu
# tahminle cevaplamak zorunda kaldik. Bu betik o tahmini gereksiz kiliyor.
#
# Salt-okunur: yalnizca kendi ucumuzu GET'ler.

set -uo pipefail

BASE="${BASE:-https://www.cyberlionai.com}"
BYPASS="$(printf '%s' "${BYPASS:-}" | tr -d '[:space:]')"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
BODY="$WORK/wm.json"

printf '\033[1mDünya haritası — kaynak bazında döküm\033[0m\n'
printf 'Adres: %s\n' "$BASE"
printf 'Zaman: %s\n\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')"

args=(-sS -o "$BODY" -w '%{http_code}' -m 60)
[ -n "$BYPASS" ] && args+=(-H "x-vercel-protection-bypass: $BYPASS")
KOD="$(curl "${args[@]}" "$BASE/api/worldmap" 2>/dev/null)" || KOD=000
printf '   HTTP %s\n\n' "$KOD"
if [ "$KOD" != "200" ]; then
  head -c 300 "$BODY" 2>/dev/null | sed 's/^/     /'
  exit 1
fi

printf '\033[1m== Kaynaklar\033[0m\n'
jq -r '.sources[] | "   \(.id | (. + "              ")[0:12]) ok=\(.ok)  cached=\(.cached)  toplam=\(.data.total // "-")  konumsuz=\(.data.unresolved // "-")  \(.error // "")"' "$BODY"

printf '\n\033[1m== Toplamlar\033[0m\n'
printf '   ucun bildirdigi konumsuz : %s\n' "$(jq -r '.unresolved // "-"' "$BODY")"
printf '   harita isareti (ulke)    : %s\n' "$(jq -r '(.markers // []) | length' "$BODY")"
printf '   isaretlerin toplami      : %s\n' "$(jq -r '[(.markers // [])[].total] | add // 0' "$BODY")"
printf '   kaynaklarin toplami      : %s\n' "$(jq -r '[.sources[].data.total // 0] | add' "$BODY")"

printf '\n\033[1m== En yoğun 5 ülke ve hangi kaynaktan geldiği\033[0m\n'
jq -r '(.markers // [])[0:5][] | "   \(.country)  toplam=\(.total)" +
       ( [ (.sources // [])[] | "  \(.id)=\(.count)" ] | join("") )' "$BODY" 2>/dev/null \
  || printf '   (işaret ayrıntısı bu yanıtta yok)\n'
