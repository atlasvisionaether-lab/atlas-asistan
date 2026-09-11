#!/usr/bin/env bash
#
# Tarama motorumuzu bağımsız araçlarla KONTROL BAZINDA karşılaştırır.
#
#   BASE=https://www.cyberlionai.com HOST=ornek.com bash tools/scanner-compare.sh
#
# NEDEN SKOR DEĞİL KONTROL KARŞILAŞTIRIYORUZ
#
# Üç araç farklı şeyler ölçüyor: SSL Labs yalnızca TLS yapılandırmasını,
# Mozilla Observatory başlıkları ve çerezleri, biz ikisinin bir karışımını.
# Skorların tutması tesadüf olurdu; tutmaması da hata anlamına gelmezdi.
#
# Cevaplanabilir soru şu: AYNI GERÇEĞİ Mİ ÖLÇÜYORUZ? Observatory de "CSP yok"
# diyor mu, SSL Labs de "TLS 1.0 kapalı" diyor mu. Mutabakat sütunu bunu
# gösteriyor. Bir aracın test etmediği kontrol "—" ile işaretleniyor;
# mutabakatsızlık sayılmıyor.
#
# Salt-okunur. Üçüncü taraf araçların ücretsiz API'leri kullanılıyor; koşu
# başına tek hedef taranıyor.

set -uo pipefail

BASE="${BASE:-https://www.cyberlionai.com}"
HOST="${HOST:-cyberlionai.com}"
BYPASS="$(printf '%s' "${BYPASS:-}" | tr -d '[:space:]')"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
UA="CyberLionAI-Compare/1.0 (+https://www.cyberlionai.com)"

head1() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
note()  { printf '   %s\n' "$1"; }

printf '\033[1mTarama motoru karşılaştırması\033[0m\n'
printf 'Hedef : %s\n' "$HOST"
printf 'Bizim : %s\n' "$BASE"
printf 'Zaman : %s\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# ---------------------------------------------------------------------------
head1 "1. Bizim taramamız"
# Cerez kavanozu: tarama kaydini sonunda AYNI oturumla silebilmek icin.
# prod-verify.sh ile ayni kural — uretimde test kaydi birakilmaz.
JAR="$WORK/jar"
args=(-sS -o "$WORK/bizim.json" -w '%{http_code}' -m 60 -X POST
      -c "$JAR" -b "$JAR"
      -H 'Content-Type: application/json' --data "{\"url\":\"$HOST\"}")
[ -n "$BYPASS" ] && args+=(-H "x-vercel-protection-bypass: $BYPASS")
KOD="$(curl "${args[@]}" "$BASE/api/scan" 2>/dev/null)" || KOD=000
note "HTTP $KOD"
if [ "$KOD" != "200" ]; then
  note "Taramamız alınamadı; karşılaştırma yapılamıyor."
  head -c 300 "$WORK/bizim.json" 2>/dev/null | sed 's/^/     /'
  exit 1
fi
BIZIM_SKOR=$(jq -r '.score // "-"' "$WORK/bizim.json")
note "skor: $BIZIM_SKOR/100"
note "kontroller: $(jq -r '[.checks[] | .id + "=" + .status] | join(" ")' "$WORK/bizim.json" 2>/dev/null | head -c 400)"

# ---------------------------------------------------------------------------
head1 "2. Mozilla Observatory"
# OLCULDU: /api/v2/scan yalnizca POST kabul ediyor; GET 404 donuyor
# ("Route GET:/api/v2/scan not found"). Sonuc dogrudan POST yanitinda.
OKOD=$(curl -sS -m 90 -A "$UA" -X POST -o "$WORK/obs.json" -w '%{http_code}' \
  "https://observatory-api.mdn.mozilla.net/api/v2/scan?host=$HOST" 2>/dev/null) || OKOD=000

# POST sonucu testleri icermiyorsa ayri sonuc ucunu dene; hangi yolun ise
# yaradigi cikti ile gorunsun.
if ! jq -e '.tests // .details' "$WORK/obs.json" >/dev/null 2>&1; then
  note "POST yanitinda test listesi yok; sonuc ucu deneniyor"
  OKOD2=$(curl -sSL -m 60 -A "$UA" -o "$WORK/obs2.json" -w '%{http_code}' \
    "https://observatory-api.mdn.mozilla.net/api/v2/results?host=$HOST" 2>/dev/null) || OKOD2=000
  note "sonuc ucu: HTTP $OKOD2  $(wc -c < "$WORK/obs2.json" 2>/dev/null || echo 0) bayt"
  if jq -e '.tests // .details' "$WORK/obs2.json" >/dev/null 2>&1; then
    mv "$WORK/obs2.json" "$WORK/obs.json"; OKOD=$OKOD2
  fi
fi
note "HTTP $OKOD  $(wc -c < "$WORK/obs.json") bayt"
if [ "$OKOD" = "200" ] && jq -e . "$WORK/obs.json" >/dev/null 2>&1; then
  note "ust duzey anahtarlar: $(jq -r 'keys | join(", ")' "$WORK/obs.json" | head -c 250)"
  note "tests anahtarlari   : $(jq -r '(.tests // {}) | keys | join(", ")' "$WORK/obs.json" | head -c 400)"
  note "derece/skor         : $(jq -r '[.grade // "-", (.score|tostring)] | join(" / ")' "$WORK/obs.json" 2>/dev/null)"
else
  note "Observatory sonucu alinamadi; ilk satir: $(head -c 200 "$WORK/obs.json" | tr -d '\n')"
fi

# ---------------------------------------------------------------------------
head1 "3. SSL Labs"
# OLCULDU: API asenkron. Ilk cagri taramayi kuyruga alip status=DNS donuyor;
# sonuc icin READY olana kadar yoklamak gerekiyor. Tek okuyup gecmek, bos
# tablo uretiyordu.
SSL_URL="https://api.ssllabs.com/api/v3/analyze?host=$HOST&fromCache=on&maxAge=24&all=done"
SKOD=000; SDURUM="-"
for deneme in $(seq 1 12); do
  SKOD=$(curl -sSL -m 60 -A "$UA" -o "$WORK/ssl.json" -w '%{http_code}' "$SSL_URL" 2>/dev/null) || SKOD=000
  SDURUM=$(jq -r '.status // "-"' "$WORK/ssl.json" 2>/dev/null)
  printf '   deneme %2s: HTTP %s  durum %s\n' "$deneme" "$SKOD" "$SDURUM"
  case "$SDURUM" in
    READY|ERROR) break ;;
  esac
  [ "$SKOD" = "429" ] && { note "hiz siniri; yoklama durduruldu"; break; }
  sleep 15
done
note "son durum: $SDURUM  ($(wc -c < "$WORK/ssl.json") bayt)"
if [ "$SDURUM" != "READY" ]; then
  note "SSL Labs sonucu HAZIR DEGIL — TLS satirlari karsilastirilamayacak."
  note "Taze tarama birkac dakika surebiliyor; koşuyu tekrarlayin."
fi
if [ "$SKOD" = "200" ] && jq -e . "$WORK/ssl.json" >/dev/null 2>&1; then
  note "durum   : $(jq -r '.status // "-"' "$WORK/ssl.json")"
  note "anahtar : $(jq -r 'keys | join(", ")' "$WORK/ssl.json" | head -c 250)"
  note "uc nokta: $(jq -r '(.endpoints // []) | length' "$WORK/ssl.json") adet"
  note "protokol: $(jq -r '[(.endpoints // [])[0].details.protocols // [] | .[] | .name + " " + .version] | join(", ")' "$WORK/ssl.json" 2>/dev/null)"
  note "derece  : $(jq -r '(.endpoints // [])[0].grade // "-"' "$WORK/ssl.json")"
else
  note "SSL Labs sonucu alinamadi; ilk satir: $(head -c 200 "$WORK/ssl.json" | tr -d '\n')"
fi

# ---------------------------------------------------------------------------
head1 "4. Kontrol bazında mutabakat"
node "$(dirname "$0")/compare-table.js" "$WORK/bizim.json" "$WORK/obs.json" "$WORK/ssl.json"

# ---------------------------------------------------------------------------
head1 "5. Temizlik — bırakılan tarama kaydı siliniyor"
# Karsilastirma icin yapilan tarama uretimde kayit olusturuyor. Birakmak,
# "uretimde test kaydi kalmasin" kuralini delerdi.
dargs=(-sS -o "$WORK/sil.json" -w '%{http_code}' -m 30 -X DELETE -c "$JAR" -b "$JAR")
[ -n "$BYPASS" ] && dargs+=(-H "x-vercel-protection-bypass: $BYPASS")
DKOD="$(curl "${dargs[@]}" "$BASE/api/history?all=1" 2>/dev/null)" || DKOD=000
SILINEN=$(jq -r '.deleted // "-"' "$WORK/sil.json" 2>/dev/null)
note "HTTP $DKOD  silinen kayıt: $SILINEN"

hargs=(-sS -o "$WORK/gecmis.json" -w '%{http_code}' -m 30 -c "$JAR" -b "$JAR")
[ -n "$BYPASS" ] && hargs+=(-H "x-vercel-protection-bypass: $BYPASS")
curl "${hargs[@]}" "$BASE/api/history" >/dev/null 2>&1 || true
KALAN=$(jq -r '(.items // []) | length' "$WORK/gecmis.json" 2>/dev/null)
if [ "$KALAN" = "0" ]; then
  printf '   \033[32mTEMİZ\033[0m  geçmiş boşaldı\n'
else
  printf '   \033[31mUYARI\033[0m  geçmişte %s kayıt kaldı\n' "$KALAN"
fi
