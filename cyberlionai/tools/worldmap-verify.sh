#!/usr/bin/env bash
#
# Dünya haritası ucunun GERÇEK beslemelere karşı doğrulaması.
#
# Neden ayrı bir betik: tools/worldmap-test.js yalnızca ayrıştırıcıları
# fikstürlere karşı sınar — ağa çıkmaz. Bu betik ise dağıtılmış ucu gerçek
# HTTP yolundan çağırır, yani beslemelerin hâlâ ölçtüğümüz biçimde yanıt
# verdiğini ve sözleşmenin bozulmadığını kanıtlar.
#
# Salt-okunur: hiçbir kayıt oluşturmaz, hiçbir şey silmez, hesap açmaz.
#
# Gerekli:
#   BASE    doğrulanacak adres (preview veya üretim)
#   BYPASS  (yalnızca preview) Vercel Protection Bypass for Automation

set -uo pipefail

BASE="${BASE:-https://www.cyberlionai.com}"
BYPASS="${BYPASS:-}"
# GitHub secret'ine yapistirilirken sona kacan satir sonu bypass'i sessizce
# gecersiz kilar; deger alfanumerik oldugu icin bosluklari atmak guvenli.
BYPASS="$(printf '%s' "$BYPASS" | tr -d '[:space:]')"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
BODY="$WORK/body.json"; HDR="$WORK/hdr.txt"

FAILED=0
UYARI=0
# Uyari metinleri: gunluk kosuda bildirime bunlar yaziliyor.
UYARI_METNI=""
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILED=1; }
# UYARI ile FAIL arasindaki fark bilerek var. Tek bir beslemenin gecici olarak
# dusmesi sozlesmenin bozuldugu anlamina gelmez — harita kalan kaynaklarla
# calismaya devam eder. Bunu "basarisiz" saymak gunluk kosuyu sik sik kirmizi
# yapar ve bir sure sonra kimse bakmaz; gercek bir ariza da o gurultunun icinde
# kaybolur. Bu yuzden dusen kaynak UYARI, sozlesme ihlali FAIL.
uyar() { printf '  \033[33mUYARI\033[0m %s\n' "$1"; UYARI=1; UYARI_METNI="$UYARI_METNI
- $1"; }
head1() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
check() { if [ "$1" = "$2" ]; then pass "$3 ($2)"; else fail "$3 — beklenen '$2', gelen '$1'"; fi; }

get() {
  local args=(-sS -o "$BODY" -D "$HDR" -w '%{http_code}' -m 40)
  [ -n "$BYPASS" ] && args+=(-H "x-vercel-protection-bypass: $BYPASS")
  curl "${args[@]}" "$BASE/api/worldmap" 2>/dev/null
}

printf '\033[1mDünya haritası ucu doğrulaması\033[0m\n'
printf 'Hedef: %s\n' "$BASE"
[ -n "$BYPASS" ] && printf 'Bypass: %d karakter\n' "${#BYPASS}" || printf 'Bypass: yok (üretim varsayılıyor)\n'

head1 "1. Uç yanıt veriyor"
STATUS="$(get)"
check "$STATUS" "200" "GET /api/worldmap"
if [ "$STATUS" != "200" ]; then
  printf '  yanıt başlığı:\n'; sed -n '1,12p' "$HDR" | sed 's/^/    /'
  printf '  gövde (ilk 400):\n'; head -c 400 "$BODY" | sed 's/^/    /'; echo
  # 503 worldmap_unavailable = Upstash yapilandirilmamis. Bu bir kod hatasi
  # degil, ortam eksigi; ayirt edilebilsin diye acikca yaziliyor.
  if grep -q 'worldmap_unavailable' "$BODY" 2>/dev/null; then
    printf '  \033[33mNOT\033[0m  Uç, Upstash yapılandırılmadığı için kapalı. Bu ortamda\n'
    printf '        UPSTASH_REDIS_REST_URL / _TOKEN tanımlı değil.\n'
  fi
  exit 1
fi

if jq -e . "$BODY" >/dev/null 2>&1; then pass "yanıt geçerli JSON"; else fail "yanıt JSON değil"; exit 1; fi

head1 "2. Sözleşme alanları"
for alan in generatedAt markers sources ownActivity; do
  if jq -e "has(\"$alan\")" "$BODY" >/dev/null 2>&1; then pass "$alan var"; else fail "$alan YOK"; fi
done
check "$(jq -r '.markers | type' "$BODY")" "array" "markers dizi"
check "$(jq -r '.sources | type' "$BODY")" "array" "sources dizi"
check "$(jq -r '.ownActivity.available' "$BODY")" "false" "ownActivity şimdilik kapalı"

head1 "3. Bütün kaynaklar bildiriliyor"
# Beklenen kaynak listesi KODUN KENDISINDEN okunuyor. Elle yazilmis liste
# curur: phishtank eklendiginde bu bolum hala uc kaynagi sayiyordu ve dorduncu
# kaynak hic kontrol edilmiyordu. Modul okunamazsa son bilinen listeye dusulur
# ve bu acikca yazilir — sessizce daha az kontrol yapmaktan iyidir.
BEKLENEN="$(node -e '
  try {
    var f = require("'"$(cd "$(dirname "$0")/.." && pwd)"'/api/_lib/feeds.js");
    process.stdout.write(f.SOURCES.map(function (s) { return s.id; }).join(" "));
  } catch (e) { process.exit(1); }
' 2>/dev/null)" || BEKLENEN=""
if [ -z "$BEKLENEN" ]; then
  BEKLENEN="feodo urlhaus torexit phishtank"
  printf '  \033[33mNOT\033[0m  feeds.js okunamadı; son bilinen liste kullanılıyor.\n'
fi
TOPLAM=0
for kaynak in $BEKLENEN; do
  TOPLAM=$((TOPLAM + 1))
  if jq -e --arg k "$kaynak" 'any(.sources[]; .id == $k)' "$BODY" >/dev/null 2>&1
    then pass "$kaynak listede"; else fail "$kaynak listede YOK"; fi
done
printf '  kaynak durumları:\n'
jq -r '.sources[] | "    \(.id): ok=\(.ok) cached=\(.cached) \(.error // "")"' "$BODY"

# Dusen her kaynak TEK TEK uyari uretiyor. Eskiden yalnizca "hepsi dustu"
# durumu goruluyordu; bir besleme sessizce kapansa harita zayiflar ve kimse
# haberdar olmazdi — bu kontrolun var olma sebebi tam olarak buydu.
DUSEN="$(jq -r '[.sources[] | select(.ok | not) | "\(.id) (\(.error // "sebep yok"))"] | join(", ")' "$BODY")"
if [ -n "$DUSEN" ] && [ "$DUSEN" != "" ]; then uyar "düşen kaynak: $DUSEN"; fi

AYAKTA="$(jq '[.sources[] | select(.ok)] | length' "$BODY")"
if [ "$AYAKTA" -gt 0 ]
  then pass "en az bir besleme ayakta ($AYAKTA/$TOPLAM)"
  else fail "BÜTÜN beslemeler düştü ($TOPLAM/$TOPLAM)"; fi

head1 "4. feodo hâlâ ülke taşıyor"
# Olcum feodo'nun .country tasidigini soyluyordu. Besleme bicim degistirirse
# harita sessizce bosalir; bu kontrol tam da onu yakalar.
FEODO_OK="$(jq -r 'any(.sources[]; .id=="feodo" and .ok)' "$BODY")"
if [ "$FEODO_OK" = "true" ]; then
  ADET="$(jq '.markers | length' "$BODY")"
  if [ "$ADET" -gt 0 ]; then
    pass "harita işareti üretildi ($ADET ülke)"
    KOTU="$(jq -r '[.markers[] | select(.country | test("^[A-Z]{2}$") | not)] | length' "$BODY")"
    check "$KOTU" "0" "tüm ülke kodları ISO-2"
    printf '  ilk üç: %s\n' "$(jq -r '[.markers[0:3][] | "\(.country)=\(.total)"] | join(", ")' "$BODY")"
  else
    fail "feodo ayakta ama HİÇ işaret yok — besleme biçimi değişmiş olabilir"
    printf '  tools/feeds-probe.sh çalıştırıp şemayı yeniden ölçün.\n'
  fi
else
  printf '  \033[33mATLANDI\033[0m  feodo şu an ulaşılamıyor; işaret kontrolü yapılamadı.\n'
fi

head1 "4b. Zaman filtresinin verisi yerinde"
# NEDEN: 1s/24s/7g filtresi bir kez sessizce islevsiz kaldi — arayuzdeki tek
# tuketicisi kayboldu ve kimse fark etmedi. Bu sefer verinin UCTA var oldugu
# her gun dogrulaniyor; kaybolursa uyari uretiliyor, sessiz kalmiyor.
PENCERELI="$(jq '[.sources[] | select(.supportsWindows == true)] | length' "$BODY" 2>/dev/null || echo 0)"
if [ "${PENCERELI:-0}" -gt 0 ]; then
  pass "zaman filtresini destekleyen kaynak var ($PENCERELI)"
  # Destekleyen kaynak AYAKTA ise isaretlerde pencere kirilimi de bulunmali.
  AYAKTA_PENCERELI="$(jq '[.sources[] | select(.supportsWindows == true and .ok)] | length' "$BODY" 2>/dev/null || echo 0)"
  if [ "${AYAKTA_PENCERELI:-0}" -gt 0 ]; then
    ISARETLI="$(jq '[.markers[] | select(.windows)] | length' "$BODY" 2>/dev/null || echo 0)"
    if [ "${ISARETLI:-0}" -gt 0 ]; then
      pass "işaretlerde pencere kırılımı var ($ISARETLI ülke)"
      # Pencereler ic ice olmali: h1 <= h24 <= d7 <= toplam. Bozuksa sayilar
      # birbirini tutmaz ve filtre yanlis sonuc gosterir.
      BOZUK="$(jq '[.markers[] | select(.windows)
        | select((.windows.h1 > .windows.h24) or (.windows.h24 > .windows.d7) or (.windows.d7 > .total))] | length' \
        "$BODY" 2>/dev/null || echo 0)"
      check "${BOZUK:-0}" "0" "pencereler iç içe (h1 ≤ h24 ≤ d7 ≤ toplam)"
      printf '   toplam pencere: %s\n' "$(jq -r '[.markers[].windows // empty]
        | {h1: (map(.h1) | add // 0), h24: (map(.h24) | add // 0), d7: (map(.d7) | add // 0)}
        | "1s=\(.h1)  24s=\(.h24)  7g=\(.d7)"' "$BODY" 2>/dev/null || echo '-')"
    else
      uyar "zaman filtresini destekleyen kaynak ayakta ama işaretlerde pencere kırılımı YOK"
    fi
  else
    printf '   \033[33mATLANDI\033[0m  pencere destekleyen kaynak şu an düşük; kırılım beklenmiyor.\n'
  fi
else
  uyar "hiçbir kaynak zaman filtresini desteklemiyor — arayüzdeki 1s/24s/7g boş kalır"
fi

head1 "5. Gizlilik — ham gösterge dışarı sızmıyor"
# Beslemelerin IP'si ve URL'si BILEREK disari verilmiyor. Bu kontrol o karari
# koruyor: birisi ayristiriciya ham alan eklerse burada yakalanir.
if grep -Eq '"[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}"' "$BODY"; then
  fail "yanıtta IP adresi var"
  grep -Eo '"[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}"' "$BODY" | head -3 | sed 's/^/    /'
else pass "IP adresi yok"; fi

if grep -Eq '"https?://[^"]*"' "$BODY"; then
  fail "yanıtta URL var"
  grep -Eo '"https?://[^"]*"' "$BODY" | head -3 | sed 's/^/    /'
else pass "besleme URL'si yok"; fi

head1 "6. Önbellek başlığı"
if grep -qi '^cache-control:.*max-age' "$HDR"; then
  pass "Cache-Control: $(grep -i '^cache-control:' "$HDR" | head -1 | tr -d '\r' | cut -d' ' -f2-)"
else fail "Cache-Control başlığı yok"; fi

head1 "7. İkinci çağrı önbellekten geliyor"
STATUS2="$(get)"
check "$STATUS2" "200" "ikinci çağrı"
if [ "$(jq -r 'any(.sources[]; .cached)' "$BODY")" = "true" ]
  then pass "en az bir kaynak önbellekten"
  else printf '  \033[33mNOT\033[0m  hiçbir kaynak önbellekten gelmedi; TTL dolmuş olabilir.\n'; fi

head1 "8. Hız sınırı uygulanıyor"
# Gunluk saglik kosusunda ATLANIR. Sebep: bu bolum kasten 30+ gercek istek
# atip sinira dayaniyor; besleme sagligiyla ilgisi yok ve gunde bir kez uretim
# ucunu bosuna dovmesi icin sebep yok. Elle kosuldugunda (dagitim dogrulamasi)
# varsayilan olarak calisir.
if [ "${HIZ_SINIRI:-1}" != "1" ]; then
  printf '  \033[33mATLANDI\033[0m  HIZ_SINIRI=0 — günlük sağlık koşusunda bu bölüm çalışmıyor.\n'
else
# ÖLÇÜLDÜ (koşu 34662353758): üretimde 34 istek attık, hiçbiri 429 almadı.
# Sebep hız sınırının bozuk olması DEĞİL: uç `Cache-Control: public,
# max-age=150` döndürüyor ve CDN aynı isteği önbellekten karşılıyor —
# fonksiyon hiç çalışmıyor, dolayısıyla sayaç da artmıyor.
#
# Sınamanın ölçmek istediği şey CDN'in değil FONKSİYONUN davranışı, bu yüzden
# her istek benzersiz bir sorgu dizisiyle gidiyor. Bu, önbelleği atlatır ve
# isteği gerçekten fonksiyona ulaştırır.
#
# Not: CDN'den dönen istekler ne bize ne beslemelere yük bindirdiği için
# önbelleklenen trafiğin sınırlanmaması bir açık değil; sınır, önbelleği
# atlatan trafikte devreye giriyor ve asıl korunması gereken de o.
KOD=""
VURUS=0
TOHUM="$(date +%s)-$$"
for i in $(seq 1 40); do
  args=(-sS -o /dev/null -D "$WORK/rl.h" -w '%{http_code}' -m 20)
  [ -n "$BYPASS" ] && args+=(-H "x-vercel-protection-bypass: $BYPASS")
  KOD="$(curl "${args[@]}" "$BASE/api/worldmap?_rl=$TOHUM-$i" 2>/dev/null)"
  VURUS=$((VURUS + 1))
  [ "$KOD" = "429" ] && break
done
CDN="$(grep -i '^x-vercel-cache:' "$WORK/rl.h" 2>/dev/null | tr -d '\r' | head -1)"
printf '   %s istek atıldı; son durum %s%s\n' "$VURUS" "$KOD" "${CDN:+  ($CDN)}"
check "$KOD" "429" "sınır aşımında 429"
fi

head1 "9. Sayfa haritayı içeriyor"
PSTATUS="$(curl -sS -o "$WORK/page.html" -w '%{http_code}' -m 30 \
  ${BYPASS:+-H "x-vercel-protection-bypass: $BYPASS"} "$BASE/" 2>/dev/null)"
check "$PSTATUS" "200" "ana sayfa"
if grep -q 'id="worldmap"' "$WORK/page.html"; then pass "harita bölümü sayfada"; else fail "harita bölümü YOK"; fi
if grep -q 'wmap__land' "$WORK/page.html"; then pass "kara parçaları gömülü"; else fail "SVG yolu YOK"; fi

printf '\n'
# Uc durum: temiz / uyari / basarisiz. Gunluk kosu bildirimi buna gore karar
# veriyor, cikis koduna gore degil — bir beslemenin dusmesi isi kirmizi
# yapmamali ama sessiz de gecmemeli.
if [ "$FAILED" -ne 0 ]; then
  DURUM=basarisiz
  printf '\033[31mBAŞARISIZ KONTROL VAR\033[0m\n'
elif [ "$UYARI" -ne 0 ]; then
  DURUM=uyari
  printf '\033[33mKONTROLLER GEÇTİ — AMA UYARI VAR\033[0m%s\n' "$UYARI_METNI"
else
  DURUM=temiz
  printf '\033[32mTÜM KONTROLLER GEÇTİ\033[0m\n'
fi

# Cagiran is akisi sonucu okuyabilsin diye. Dosya yolu verilmediyse hicbir sey
# yazilmaz; betik elle kosuldugunda davranisi degismiyor.
if [ -n "${DURUM_DOSYASI:-}" ]; then
  {
    printf 'durum=%s\n' "$DURUM"
    printf 'ayakta=%s\n' "${AYAKTA:-0}"
    printf 'toplam=%s\n' "${TOPLAM:-0}"
    printf 'dusen=%s\n' "${DUSEN:-}"
  } > "$DURUM_DOSYASI" 2>/dev/null || :
fi

exit "$FAILED"
