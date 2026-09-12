#!/usr/bin/env bash
#
# worldmap-verify.sh'in KARAR MANTIĞININ sınaması — AĞ GEREKTİRMEZ.
#
#   bash cyberlionai/tools/worldmap-verify-test.sh
#
# NEDEN VAR
#
# Doğrulama betiği artık günlük koşuyor ve çıktısına göre bildirim üretiliyor.
# Betikteki bir kabuk hatası, bildirimi sessizce yanlış tarafa düşürür: düşen
# bir besleme "temiz" görünür ve haritanın zayıfladığını kimse fark etmez.
# Tam olarak önlemek istediğimiz şey buydu; o yüzden karar mantığı sınanıyor.
#
# NASIL
#
# `curl` PATH üzerinden sahtesiyle değiştiriliyor ve ölçülmüş biçimde sabit
# yanıtlar veriyor. Gerçek ağa çıkılmıyor, üretime dokunulmuyor.
#
# Sınanan üç durum:
#   temiz     — bütün kaynaklar ayakta
#   uyari     — bir kaynak düştü; iş KIRMIZI OLMAMALI ama sessiz de geçmemeli
#   basarisiz — bütün kaynaklar düştü

set -uo pipefail

BETIK="$(cd "$(dirname "$0")" && pwd)/worldmap-verify.sh"
KOK="$(mktemp -d)"; trap 'rm -rf "$KOK"' EXIT

GECTI=0
KALAN=0

# --- Sahte curl -----------------------------------------------------------
# Gerçek curl'ün bu betikte kullanılan arayüzünü taklit eder: -o, -D ve
# '%{http_code}' yazan -w. Gövde, $SAHTE_GOVDE dosyasından kopyalanır.
mkdir -p "$KOK/bin"
cat > "$KOK/bin/curl" <<'SAHTE'
#!/usr/bin/env bash
CIKTI=""; BASLIK=""; URL=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) CIKTI="$2"; shift 2 ;;
    -D) BASLIK="$2"; shift 2 ;;
    -w) shift 2 ;;
    -m) shift 2 ;;
    -H) shift 2 ;;
    -sS|-s|-S|-L) shift ;;
    -*) shift ;;
    *) URL="$1"; shift ;;
  esac
done
case "$URL" in
  *api/worldmap*) KAYNAK="$SAHTE_GOVDE" ;;
  *)              KAYNAK="$SAHTE_SAYFA" ;;
esac
[ -n "$CIKTI" ] && cat "$KAYNAK" > "$CIKTI"
[ -n "$BASLIK" ] && printf 'HTTP/2 200\r\ncontent-type: application/json\r\ncache-control: public, max-age=150\r\nx-vercel-cache: MISS\r\n\r\n' > "$BASLIK"
printf '200'
SAHTE
chmod +x "$KOK/bin/curl"

cat > "$KOK/sayfa.html" <<'HTML'
<section id="worldmap"><svg><path class="wmap__land" d="M0 0"/></svg></section>
HTML

# --- Gövde üreteci --------------------------------------------------------
# $1: feodo ok, $2: urlhaus ok, $3: torexit ok, $4: phishtank ok
govde() {
  local dosya="$KOK/govde.json"
  python3 - "$dosya" "$@" <<'PY'
import json, sys
dosya = sys.argv[1]
durum = dict(zip(['feodo', 'urlhaus', 'torexit', 'phishtank'], sys.argv[2:6]))
kaynaklar = []
for kid, ok in durum.items():
    k = {'id': kid, 'label': kid, 'geo': True, 'ok': ok == '1', 'cached': True}
    if ok != '1':
        k['error'] = 'feed_status_503'
    else:
        k['summary'] = {'total': 10, 'countries': 2}
    kaynaklar.append(k)
isaretler = [] if all(v != '1' for v in durum.values()) else [
    {'country': 'US', 'total': 120, 'intensity': 1.0},
    {'country': 'NL', 'total': 40, 'intensity': 0.7},
    {'country': 'CN', 'total': 12, 'intensity': 0.4},
]
json.dump({
    'generatedAt': '2026-09-12T09:00:00.000Z',
    'markers': isaretler,
    'topCountries': isaretler,
    'threatTypes': [],
    'unresolved': 0,
    'geoTable': {'ok': True},
    'sources': kaynaklar,
    'ownActivity': {'available': False, 'reason': 'no_geo_in_scan_history', 'countries': []},
}, open(dosya, 'w'))
PY
  printf '%s' "$dosya"
}

kos() {  # <feodo> <urlhaus> <torexit> <phishtank>
  local g; g="$(govde "$@")"
  rm -f "$KOK/durum.txt"
  PATH="$KOK/bin:$PATH" \
  SAHTE_GOVDE="$g" SAHTE_SAYFA="$KOK/sayfa.html" \
  BASE="https://ornek.gecersiz" BYPASS="" HIZ_SINIRI=0 \
  DURUM_DOSYASI="$KOK/durum.txt" \
    bash "$BETIK" > "$KOK/cikti.txt" 2>&1
  KOD=$?
  return $KOD
}

dene() {  # <ad> <beklenen durum> <beklenen cikis kodu> <feodo> <urlhaus> <torexit> <phishtank>
  local ad="$1" bdurum="$2" bkod="$3"; shift 3
  kos "$@"; local kod=$?
  local durum; durum="$(grep '^durum=' "$KOK/durum.txt" 2>/dev/null | cut -d= -f2)"
  if [ "$durum" = "$bdurum" ] && [ "$kod" = "$bkod" ]; then
    GECTI=$((GECTI + 1)); printf '  \033[32mGEÇTİ\033[0m  %s\n' "$ad"
  else
    KALAN=$((KALAN + 1))
    printf '  \033[31mKALDI\033[0m  %s — durum '"'"'%s'"'"' (beklenen '"'"'%s'"'"'), çıkış %s (beklenen %s)\n' \
      "$ad" "${durum:-yok}" "$bdurum" "$kod" "$bkod"
    sed -n '1,60p' "$KOK/cikti.txt" | sed 's/^/      /'
  fi
}

printf '\033[1mDurum ayrımı\033[0m\n'
dene 'bütün kaynaklar ayakta → temiz'          temiz     0 1 1 1 1
dene 'bir kaynak düştü → uyarı, iş kırmızı değil' uyari  0 0 1 1 1
dene 'iki kaynak düştü → yine uyarı'           uyari     0 0 0 1 1
dene 'bütün kaynaklar düştü → başarısız'       basarisiz 1 0 0 0 0

printf '\033[1mUyarı metni düşen kaynağı adıyla söylüyor\033[0m\n'
kos 0 1 1 1 >/dev/null 2>&1
if grep -q 'düşen kaynak: feodo' "$KOK/cikti.txt"; then
  GECTI=$((GECTI + 1)); printf '  \033[32mGEÇTİ\033[0m  düşen kaynağın adı çıktıda\n'
else
  KALAN=$((KALAN + 1)); printf '  \033[31mKALDI\033[0m  düşen kaynağın adı çıktıda yok\n'
fi
if grep -q 'feed_status_503' "$KOK/cikti.txt"; then
  GECTI=$((GECTI + 1)); printf '  \033[32mGEÇTİ\033[0m  sebep de yazılıyor\n'
else
  KALAN=$((KALAN + 1)); printf '  \033[31mKALDI\033[0m  sebep yazılmıyor\n'
fi

printf '\033[1mKaynak listesi koddan türetiliyor\033[0m\n'
# feeds.js dort kaynak beyan ediyor; betik dordunu de aramali. Elle yazilmis
# uc kaynakli liste geri gelirse bu sinama kalir.
kos 1 1 1 1 >/dev/null 2>&1
EKSIK=""
for k in feodo urlhaus torexit phishtank; do
  grep -q "PASS.*$k listede" "$KOK/cikti.txt" || EKSIK="$EKSIK $k"
done
if [ -z "$EKSIK" ]; then
  GECTI=$((GECTI + 1)); printf '  \033[32mGEÇTİ\033[0m  dört kaynağın dördü de aranıyor\n'
else
  KALAN=$((KALAN + 1)); printf '  \033[31mKALDI\033[0m  aranmayan kaynak:%s\n' "$EKSIK"
fi
if grep -q 'ayakta (4/4)' "$KOK/cikti.txt"; then
  GECTI=$((GECTI + 1)); printf '  \033[32mGEÇTİ\033[0m  toplam sabit değil, listeden geliyor\n'
else
  KALAN=$((KALAN + 1)); printf '  \033[31mKALDI\033[0m  toplam yanlış\n'
  grep 'ayakta' "$KOK/cikti.txt" | sed 's/^/      /'
fi

printf '\033[1mHız sınırı bölümü günlük koşuda atlanıyor\033[0m\n'
if grep -q 'HIZ_SINIRI=0' "$KOK/cikti.txt"; then
  GECTI=$((GECTI + 1)); printf '  \033[32mGEÇTİ\033[0m  atlandığı açıkça yazılıyor\n'
else
  KALAN=$((KALAN + 1)); printf '  \033[31mKALDI\033[0m  atlama notu yok\n'
fi

printf '\nGeçen: %s   Kalan: %s\n' "$GECTI" "$KALAN"
[ "$KALAN" -eq 0 ] || exit 1
