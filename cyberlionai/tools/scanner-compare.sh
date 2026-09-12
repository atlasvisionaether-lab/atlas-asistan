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
head1 "0. Hedef gerçekten taranabilir mi"
# Hedef bir kimlik duvarinin arkasindaysa Observatory ve SSL Labs asil sayfayi
# degil giris ekranini olcer; uretilecek mutabakat orani anlamsiz olur. Bu
# yuzden kontrol ZINCIRIN BASINDA — boylece uretimde tarama kaydi da olusmaz
# (o kayit 1. adimda olusuyor). Algilama tools/auth-wall.sh icinde, sinamasi
# tools/wall-test.sh icinde.
. "$(dirname "$0")/auth-wall.sh"

DURUM="$(curl -sS -m 30 -A "$UA" -o "$WORK/ham.gov" -D "$WORK/ham.bas" \
  -w '%{http_code} %{redirect_url}' "https://$HOST/" 2>/dev/null)" || DURUM="000 "
HKOD="${DURUM%% *}"
HYON="${DURUM#* }"
note "anonim istek: HTTP $HKOD${HYON:+  → $HYON}"

if DUVAR="$(kimlik_duvari "$HKOD" "$HYON" "$WORK/ham.bas" "$HOST")"; then
  printf '   \033[31mHEDEF SSO/GİRİŞ KORUMALI — TEST GEÇERSİZ\033[0m\n'
  note "belirti: $DUVAR"
  note ""
  note "Observatory ve SSL Labs bu adrese anonim erişiyor; asıl sayfayı değil"
  note "giriş ekranını ölçerler. Üretilecek her mutabakat oranı anlamsız olurdu,"
  note "bu yüzden tablo üretilmiyor ve tarama yapılmıyor."
  note ""
  note "Yapılacak: hedefi dış araçlara açık bir adrese taşıyın (örn. özel alan"
  note "adı), sonra tekrar koşun. Koruma bypass'ı çözüm değil — o anahtar bizim"
  note "API'mize gider, hedefi getiren üçüncü taraflara değil."
  exit 2
fi
note "kimlik duvarı belirtisi yok; karşılaştırmaya geçiliyor"

# Capraz koken basliklarinin HAM degeri. Neden: iki arac ayni "pass" harfini
# farkli olgular icin verebiliyor — Observatory yoklugu da pass sayiyor, biz
# varligi pass sayiyoruz. Ayni harf, ayni gercek anlamina gelmeyebilir. Ham
# deger yazilmadan tablodaki o satira guvenilemez.
printf '   ham çapraz köken başlıkları:\n'
for BSLK in cross-origin-opener-policy cross-origin-embedder-policy \
            cross-origin-resource-policy access-control-allow-origin \
            access-control-allow-credentials; do
  DEGER="$(grep -i "^$BSLK:" "$WORK/ham.bas" 2>/dev/null | head -1 | cut -d: -f2- | tr -d "\r" | sed "s/^ *//")"
  printf '     %-34s %s\n' "$BSLK" "${DEGER:-(yok)}"
done

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

# OLCULDU (kosu 34559696176): POST yaniti yalnizca OZET donuyor —
# grade/score/id/tests_passed var, per-test listesi YOK. Bu yuzden tablodaki
# yedi Observatory satiri "—" cikiyordu. Ozet icindeki .id ile ayri bir test
# ucu yoklanir; hangi adresin ise yaradigi ciktida gorunur ki eslemenin
# sessizce bozulmasi mumkun olmasin.
OBS_ID=$(jq -r '.id // empty' "$WORK/obs.json" 2>/dev/null)
if ! jq -e '(.tests // .details) | objects | length > 0' "$WORK/obs.json" >/dev/null 2>&1; then
  note "POST yaniti yalnizca ozet ( id=${OBS_ID:--} ); test listesi ayrica isteniyor"
  # Ozet cok kucuk (˜280 bayt) ve gizli bilgi icermiyor; tamamini yazmak,
  # ucun hangi alanlari verdigini tahmine birakmiyor.
  note "ozet: $(tr -d '\n' < "$WORK/obs.json" | head -c 400)"
  OBS_DETAY=$(jq -r '.details_url // empty' "$WORK/obs.json" 2>/dev/null)
  for uc in \
    "https://observatory-api.mdn.mozilla.net/api/v2/tests?scan=$OBS_ID" \
    "https://observatory-api.mdn.mozilla.net/api/v2/scan/$OBS_ID/tests" \
    "https://observatory-api.mdn.mozilla.net/api/v2/analyze?host=$HOST" \
    "https://observatory-api.mdn.mozilla.net/api/v2/results?host=$HOST" \
    "$OBS_DETAY"
  do
    [ -z "$uc" ] && continue
    [ -z "$OBS_ID" ] && case "$uc" in *scan=*|*/scan/*) continue ;; esac
    TKOD=$(curl -sSL -m 60 -A "$UA" -o "$WORK/obs_t.json" -w '%{http_code}' "$uc" 2>/dev/null) || TKOD=000
    note "test ucu: HTTP $TKOD  $(wc -c < "$WORK/obs_t.json" 2>/dev/null || echo 0) bayt  ${uc#https://observatory-api.mdn.mozilla.net}"
    if [ "$TKOD" = "200" ] && jq -e 'objects | length > 0' "$WORK/obs_t.json" >/dev/null 2>&1; then
      # Test listesi ozetin yanina .tests olarak eklenir; tablo scripti
      # .tests bekliyor, ozetteki grade/score da korunur.
      jq -s '.[0] + {tests: (.[1].tests // .[1])}' "$WORK/obs.json" "$WORK/obs_t.json" \
        > "$WORK/obs_m.json" 2>/dev/null && mv "$WORK/obs_m.json" "$WORK/obs.json"
      break
    fi
  done
fi
note "HTTP $OKOD  $(wc -c < "$WORK/obs.json") bayt"
if [ "$OKOD" = "200" ] && jq -e . "$WORK/obs.json" >/dev/null 2>&1; then
  note "ust duzey anahtarlar: $(jq -r 'keys | join(", ")' "$WORK/obs.json" | head -c 250)"
  note "tests anahtarlari   : $(jq -r '(.tests // {}) | keys | join(", ")' "$WORK/obs.json" | head -c 400)"
  # Her testin ham sonucu yaziliyor. Observatory "gecti/kaldi"yi tek alanda
  # tasimiyor; pass, result ve score_modifier birlikte anlamli. Tabloda bir
  # satir beklenmedik cikarsa sebebi burada gorunur, tahmin gerekmez.
  jq -r '(.tests // {}) | to_entries[] | "     \(.key): pass=\(.value.pass) result=\(.value.result) m=\(.value.score_modifier)"' \
    "$WORK/obs.json" 2>/dev/null | head -20
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
