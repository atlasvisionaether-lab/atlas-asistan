#!/usr/bin/env bash
#
# PhishTank sayimimizin NE saydigini olcer.
#
#   bash tools/phishtank-probe.sh
#
# NEDEN GEREKLI
#
# feeds.js icindeki akis sayaci gövdedeki her `"country":"XX"` eslesmesini
# sayiyor ve bu sayiyi haritada "kayit" diye sunuyoruz. Ama PhishTank'in
# semasinda ulke, girdinin KENDISINDE degil `details[]` dizisinin icinde:
#
#   [{ phish_id, url, ..., details: [{ ip_address, country, detail_time }, ...] }]
#
# Bir kimlik avi adresi birden fazla barindirma kaydi tasiyorsa, bizim
# "toplam"imiz adres sayisini degil DETAY SATIRI sayisini verir. Sondamiz
# bugune kadar yalnizca `.0.` indekslerine bakmisti; girdi basina kac detay
# oldugunu hic olcmedik. Bu betik tam olarak onu olcer.
#
# Salt-okunur. Tek bir indirme yapar.

set -uo pipefail

URL="${URL:-https://data.phishtank.com/data/online-valid.json}"
UA='CyberLionAI-WorldMap/1.0 (+https://www.cyberlionai.com)'
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
GOVDE="$WORK/body.json"

printf '\033[1mPhishTank sayim ölçümü\033[0m\n'
printf 'Adres: %s\n' "$URL"
printf 'Zaman: %s\n\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# Iki semayi da dene. geo-probe.sh olcumu (03:46 UTC) http:// uzerinden 200 ve
# 41.6 MB almisti; feeds.js ise https:// kullaniyor. Ikisi ayni davranmiyor
# olabilir ve bu, beslemenin neden bazen dustugunu acikliyor olabilir.
INDIRILDI=""
for SEMA in https http; do
  ADRES="$SEMA://data.phishtank.com/data/online-valid.json"
  KOD="$(curl -sSL -m 180 -A "$UA" -o "$WORK/$SEMA.json" -w '%{http_code}' "$ADRES" 2>/dev/null)" || KOD=000
  BAYT="$(wc -c < "$WORK/$SEMA.json" 2>/dev/null || echo 0)"
  TUR="$(file -b --mime-type "$WORK/$SEMA.json" 2>/dev/null || echo '?')"
  printf '   %-5s  HTTP %s  %9s bayt  %s\n' "$SEMA" "$KOD" "$BAYT" "$TUR"
  if [ "$KOD" = "200" ] && jq -e 'type == "array"' "$WORK/$SEMA.json" >/dev/null 2>&1; then
    [ -z "$INDIRILDI" ] && { cp "$WORK/$SEMA.json" "$GOVDE"; INDIRILDI="$SEMA"; }
  fi
done

if [ -z "$INDIRILDI" ]; then
  printf '\n   \033[31mHicbir sema kullanilabilir JSON vermedi.\033[0m\n'
  printf '   Bu, beslemenin anahtarsiz toplu indirmeyi kapattigi anlamina gelebilir.\n'
  printf '   Ilk 200 bayt (https):\n'
  head -c 200 "$WORK/https.json" 2>/dev/null | tr -c '[:print:]' '.' | sed 's/^/     /'
  printf '\n'
  exit 1
fi
printf '\n   Olcum "%s" govdesi uzerinden yapiliyor.\n' "$INDIRILDI"

printf '\n\033[1m== Gerçek sayılar (jq ile kesin)\033[0m\n'
GIRDI="$(jq 'length' "$GOVDE")"
DETAY="$(jq '[.[].details // [] | length] | add // 0' "$GOVDE")"
DETAY_ULKELI="$(jq '[.[].details // [] | .[] | select(.country != null and .country != "")] | length' "$GOVDE")"
COKLU="$(jq '[.[] | select(((.details // []) | length) > 1)] | length' "$GOVDE")"
ENFAZLA="$(jq '[.[].details // [] | length] | max // 0' "$GOVDE")"
printf '   kimlik avı adresi (girdi)   : %s\n' "$GIRDI"
printf '   detay satırı (details[])    : %s\n' "$DETAY"
printf '   ülke taşıyan detay satırı   : %s\n' "$DETAY_ULKELI"
printf '   birden fazla detayı olan    : %s\n' "$COKLU"
printf '   bir girdideki en fazla detay: %s\n' "$ENFAZLA"

printf '\n\033[1m== Bizim akış sayacımızın göreceği\033[0m\n'
# feeds.js ile AYNI desen. Sayim yontemi farkli (burada grep, orada akis) ama
# desen ayni oldugu icin sonuc karsilastirilabilir olmali.
REGEX_SAYI="$(grep -o '"country"[[:space:]]*:[[:space:]]*"[A-Za-z][A-Za-z]"' "$GOVDE" | wc -l | tr -d ' ')"
printf '   "country":"XX" eşleşmesi    : %s\n' "$REGEX_SAYI"

printf '\n\033[1m== Sonuç\033[0m\n'
if [ "$GIRDI" -gt 0 ] && [ "$REGEX_SAYI" -gt 0 ]; then
  # Tam sayi aritmetigi: yuzde olarak sapma.
  SAPMA=$(( (REGEX_SAYI - GIRDI) * 100 / GIRDI ))
  printf '   Haritada "kayıt" diye gösterdiğimiz sayı : %s\n' "$REGEX_SAYI"
  printf '   Gerçek kimlik avı adresi sayısı          : %s\n' "$GIRDI"
  printf '   Sapma                                    : %%%s\n' "$SAPMA"
  if [ "$REGEX_SAYI" -gt "$GIRDI" ]; then
    printf '   \033[31mŞİŞİK\033[0m  Sayacımız adres değil detay satırı sayıyor.\n'
  elif [ "$REGEX_SAYI" -eq "$GIRDI" ]; then
    printf '   \033[32mTUTUYOR\033[0m  Her girdide tam bir ülkeli detay var.\n'
  else
    printf '   \033[33mDÜŞÜK\033[0m  Bazı girdilerde ülkeli detay yok.\n'
  fi
fi

printf '\n\033[1m== Örnek girdi (ilk, kısaltılmış)\033[0m\n'
jq -c '.[0] | {phish_id, url: (.url[0:60]), detay_sayisi: ((.details // []) | length),
               ilk_detay: ((.details // [])[0] | {ip_address, country})}' "$GOVDE" 2>/dev/null | sed 's/^/   /'
