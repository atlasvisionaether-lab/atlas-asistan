#!/usr/bin/env bash
#
# Üretim doğrulaması — gerçek genel HTTP yolu üzerinden.
#
# Bu betik GitHub Actions runner'ında çalışır; tarayıcının gördüğü uçlara,
# tarayıcının gördüğü gibi (çerezlerle) istek atar. Üretime hiçbir geçici kod
# eklenmez. Ürettiği her kayıt sonunda gerçek silme ucuyla temizlenir.
#
# Hedef sabittir: yalnızca kendi alan adımız taranır.

set -uo pipefail

BASE="${BASE:-https://www.cyberlionai.com}"
TARGET="cyberlionai.com"
FREE_LIMIT=5
RATE_MAX=12

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
JAR_A="$WORK/a.jar"; JAR_B="$WORK/b.jar"; JAR_C="$WORK/c.jar"

FAILED=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILED=1; }
head1() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
check() { if [ "$1" = "$2" ]; then pass "$3 ($2)"; else fail "$3 — beklenen '$2', gelen '$1'"; fi; }

# scan JAR -> STATUS, BODY dosyası, HDR dosyası
scan() {
  BODY="$WORK/body.json"; HDR="$WORK/hdr.txt"
  STATUS=$(curl -sS -o "$BODY" -D "$HDR" -w '%{http_code}' \
    -c "$1" -b "$1" -X POST "$BASE/api/scan" \
    -H 'content-type: application/json' \
    --data "{\"url\":\"$TARGET\"}")
}

api() { # api JAR METHOD PATH [JSON_GOVDE] -> STATUS, BODY, HDR
  BODY="$WORK/body.json"; HDR="$WORK/hdr.txt"
  if [ $# -ge 4 ]; then
    STATUS=$(curl -sS -o "$BODY" -D "$HDR" -w '%{http_code}' \
      -c "$1" -b "$1" -X "$2" "$BASE$3" \
      -H 'content-type: application/json' --data "$4")
  else
    STATUS=$(curl -sS -o "$BODY" -D "$HDR" -w '%{http_code}' \
      -c "$1" -b "$1" -X "$2" "$BASE$3")
  fi
}

hdr() { grep -i "^$1:" "$HDR" | tail -1 | cut -d' ' -f2- | tr -d '\r'; }

echo "Hedef ortam: $BASE"
echo "Taranan alan adı: $TARGET (kendi altyapımız)"

################################################################################
head1 "1. Gerçek tarama sonucu ve ücretsiz kota (oturum A)"
################################################################################
REMAINING=""
FIRST_SUMMARY=""
for i in $(seq 1 $FREE_LIMIT); do
  scan "$JAR_A"
  if [ "$STATUS" != "200" ]; then
    fail "tarama $i beklenmedik durum: $STATUS — $(head -c 300 "$BODY")"
    break
  fi
  R=$(jq -r '.quota.remaining' "$BODY")
  REMAINING="$REMAINING$R "
  if [ "$i" = "1" ]; then
    SCORE=$(jq -r '.score' "$BODY")
    SCAN_ID_A=$(jq -r '.scanId' "$BODY")
    FIRST_SUMMARY=$(jq -r '"skor=\(.score) gecti=\([.checks[]|select(.status=="pass")]|length) kaldi=\([.checks[]|select(.status=="fail")]|length) olculemedi=\([.checks[]|select(.status=="skipped")]|length) sure=\(.durationMs)ms"' "$BODY")
    echo "  ilk tarama: $FIRST_SUMMARY"
    echo "  scanId: $SCAN_ID_A"
    echo "  TLS/başlık bulguları:"
    jq -r '.checks[] | "    \(.status|ascii_upcase|.[0:4])  \(.id)  [\(.severity)]"' "$BODY"
    [ "$SCORE" != "null" ] && [ "$SCORE" -ge 0 ] 2>/dev/null \
      && pass "gerçek dinamik skor döndü: $SCORE/100" \
      || fail "skor sayı değil: $SCORE"
    [ "$SCAN_ID_A" != "null" ] && [ -n "$SCAN_ID_A" ] \
      && pass "scanId döndü (cl_scans'e yazıldı)" \
      || fail "scanId null — veritabanına yazılamadı"
  fi
done
check "$(echo $REMAINING)" "4 3 2 1 0" "kota sayacı 5 taramada tükendi"

head1 "2. Kota aşımı (6. tarama)"
scan "$JAR_A"
check "$STATUS" "402" "6. tarama reddedildi"
CODE=$(jq -r '.error.code' "$BODY")
check "$CODE" "quota_exceeded" "makine-okunur kod (arayüz kayıt modalını açar)"
echo "  gövde: $(cat "$BODY")"

head1 "3. İkinci anonim oturum (B) — kendi kotası"
REM_B=""
for i in $(seq 1 $FREE_LIMIT); do
  scan "$JAR_B"
  [ "$STATUS" = "200" ] || { fail "B tarama $i durum $STATUS"; break; }
  REM_B="$REM_B$(jq -r '.quota.remaining' "$BODY") "
done
check "$(echo $REM_B)" "4 3 2 1 0" "B oturumu bağımsız 5 hakka sahip"
SCAN_ID_B=$(jq -r '.scanId' "$BODY")

################################################################################
head1 "4. Geçmiş — yalnızca kendi oturumunun kayıtları"
################################################################################
api "$JAR_A" GET /api/history
check "$STATUS" "200" "A geçmişi okundu"
COUNT_A=$(jq -r '.items|length' "$BODY")
check "$COUNT_A" "5" "A oturumu 5 kayıt görüyor"
jq -r '.items[] | "    \(.host)  \(.score)/100  gecti=\(.checks_passed) kaldi=\(.checks_failed) olculemedi=\(.checks_skipped)  \(.scanned_at)"' "$BODY"
jq -r '.items[].id' "$BODY" | sort > "$WORK/ids_a.txt"

api "$JAR_B" GET /api/history
COUNT_B=$(jq -r '.items|length' "$BODY")
check "$COUNT_B" "5" "B oturumu 5 kayıt görüyor"
jq -r '.items[].id' "$BODY" | sort > "$WORK/ids_b.txt"

OVERLAP=$(comm -12 "$WORK/ids_a.txt" "$WORK/ids_b.txt" | wc -l | tr -d ' ')
check "$OVERLAP" "0" "iki oturumun kayıt kümeleri kesişmiyor"

################################################################################
head1 "5. PDF raporu"
################################################################################
PDF="$WORK/rapor.pdf"
PSTATUS=$(curl -sS -o "$PDF" -D "$HDR" -w '%{http_code}' -c "$JAR_A" -b "$JAR_A" \
  "$BASE/api/report?id=$SCAN_ID_A&lang=tr")
check "$PSTATUS" "200" "PDF indirildi"
check "$(hdr content-type)" "application/pdf" "içerik türü"
echo "  Content-Disposition: $(hdr content-disposition)"
echo "  X-Content-Type-Options: $(hdr x-content-type-options)"
echo "  boyut: $(wc -c < "$PDF") bayt"
# Host, apex'ten www'ye yönlendiği için taranan host www.cyberlionai.com olur.
hdr content-disposition | grep -qE 'attachment; filename="cyberlionai-security-report-[a-z0-9.-]+-[0-9]{4}-[0-9]{2}-[0-9]{2}\.pdf"' \
  && pass "dosya adı deseni doğru" || fail "dosya adı deseni beklenenden farklı"
head -c 8 "$PDF" | grep -q '%PDF-' && pass "geçerli PDF imzası" || fail "PDF imzası yok"

echo "  --- pdftotext ile çıkarılan metin (ToUnicode CMap sınaması) ---"
pdftotext -enc UTF-8 "$PDF" "$WORK/rapor.txt" 2>/dev/null
head -20 "$WORK/rapor.txt" | sed 's/^/    /'
for word in "GÜVENLİK RAPORU" "Ölçülemedi" "Düşük" "Eşikler" "Kaldı"; do
  if grep -qF "$word" "$WORK/rapor.txt"; then
    pass "Türkçe metin doğru çıkarıldı: '$word'"
  else
    fail "Türkçe metin bozuk veya yok: '$word'"
  fi
done

# Büyük harfe çevrilen etiketler: JS'in toUpperCase()'i 'i' harfini 'I' yapar,
# Türkçede doğrusu 'İ'dir. Bu üç etiket dile duyarlı dönüşümden geçmeli.
for word in "GÜVENLİK SKORU" "RİSK SEVİYESİ" "KONTROL ÖZETİ"; do
  if grep -qF "$word" "$WORK/rapor.txt"; then
    pass "Türkçe büyük harf doğru: '$word'"
  else
    fail "Türkçe büyük harf hatalı (noktasız I): '$word' bulunamadı"
  fi
done

# İngilizce sürüm de üretilebiliyor mu
ESTATUS=$(curl -sS -o "$WORK/rapor-en.pdf" -w '%{http_code}' -c "$JAR_A" -b "$JAR_A" \
  "$BASE/api/report?id=$SCAN_ID_A&lang=en")
check "$ESTATUS" "200" "EN raporu da üretildi"

################################################################################
head1 "6. Oturumlar arası erişim — 404 beklenir"
################################################################################
api "$JAR_B" GET "/api/report?id=$SCAN_ID_A"
check "$STATUS" "404" "B, A'nın raporunu indiremiyor"
check "$(jq -r '.error.code' "$BODY")" "not_found" "varlık sızdırılmıyor (not_found)"

api "$JAR_B" DELETE "/api/history?id=$SCAN_ID_A"
check "$STATUS" "404" "B, A'nın kaydını silemiyor"

api "$JAR_A" GET "/api/report?id=$SCAN_ID_A"
check "$STATUS" "200" "A'nın kaydı hâlâ duruyor (silinmemiş)"

# Çerezsiz (oturumsuz) erişim
NSTATUS=$(curl -sS -o "$BODY" -w '%{http_code}' "$BASE/api/report?id=$SCAN_ID_A")
check "$NSTATUS" "404" "çerezsiz istek de 404 alıyor"

################################################################################
head1 "7. IP hız sınırı"
################################################################################
# Buraya kadar aynı IP'den 11 /api/scan isteği yapıldı (A:6, B:5).
scan "$JAR_C"
echo "  12. istek durumu: $STATUS  (sınır: $RATE_MAX)"
scan "$JAR_C"
check "$STATUS" "429" "13. istek hız sınırına takıldı"
RETRY=$(hdr retry-after)
echo "  Retry-After: $RETRY"
[ -n "$RETRY" ] && [ "$RETRY" -gt 0 ] 2>/dev/null \
  && pass "Retry-After saniye cinsinden döndü" || fail "Retry-After yok/geçersiz"
check "$(jq -r '.error.code' "$BODY")" "rate_limited" "makine-okunur kod"

# Sahte X-Forwarded-For ile atlatma denemesi
SSTATUS=$(curl -sS -o "$BODY" -w '%{http_code}' -c "$JAR_C" -b "$JAR_C" \
  -X POST "$BASE/api/scan" -H 'content-type: application/json' \
  -H 'X-Forwarded-For: 1.2.3.4' -H 'X-Real-IP: 1.2.3.4' \
  --data "{\"url\":\"$TARGET\"}")
check "$SSTATUS" "429" "sahte X-Forwarded-For / X-Real-IP sınırı atlatamadı"


################################################################################
head1 "9. Kimlik doğrulama (üretimde hesap OLUŞTURMADAN)"
################################################################################
# Üretimde kayıt yapmıyoruz: gerçek e-posta gönderir ve auth.users'tan
# silinmesi service_role gerektirir; o anahtarı CI'ya koymak, doğrulamanın
# kazandırdığından fazlasını riske atardı. Bu yüzden yalnızca hesap
# yaratmayan kontroller.

api "$JAR_A" GET /api/auth/me
check "$STATUS" "200" "me ucu yanıt veriyor"
check "$(jq -r '.available' "$BODY")" "true" "SUPABASE_ANON_KEY tanımlı (kimlik servisi açık)"
check "$(jq -r '.authenticated' "$BODY")" "false" "çerezsiz istek anonim"

# Kullanıcı sayımına karşı: var olmayan iki farklı adres AYNI kodu almalı.
api "$JAR_A" POST /api/auth/login '{"email":"yok-1@cyberlionai-test.invalid","password":"HerhangiBirSifre123"}'
C1=$(jq -r '.error.code' "$BODY"); S1=$STATUS
api "$JAR_A" POST /api/auth/login '{"email":"yok-2@cyberlionai-test.invalid","password":"BaskaBirSifre1234"}'
C2=$(jq -r '.error.code' "$BODY")
check "$S1" "401" "hatalı giriş reddedildi"
check "$C1" "invalid_credentials" "genel hata kodu"
check "$C2" "$C1" "farklı adresler aynı kodu alıyor (hesap varlığı sızmıyor)"

api "$JAR_A" POST /api/auth/recover '{"email":"kesinlikle-yok@cyberlionai-test.invalid"}'
check "$STATUS" "200" "sıfırlama isteği: kayıtsız adres için de 200"

api "$JAR_A" POST /api/auth/register '{"email":"bozuk-adres","password":"YeterinceUzunSifre1"}'
check "$(jq -r '.error.code' "$BODY")" "invalid_email" "bozuk e-posta reddedildi"

api "$JAR_A" POST /api/auth/password '{"password":"OturumsuzSifre12345"}'
check "$STATUS" "401" "oturumsuz şifre değişikliği reddedildi"
check "$(jq -r '.error.code' "$BODY")" "not_authenticated" "kod"

api "$JAR_A" POST /api/auth/verify '{"token_hash":"gecersiz-kod","type":"recovery"}'
check "$STATUS" "400" "geçersiz bağlantı kodu reddedildi"
check "$(jq -r '.error.code' "$BODY")" "link_invalid" "kod"

api "$JAR_A" GET /api/auth/login
check "$STATUS" "405" "GET ile giriş denemesi reddedildi"

################################################################################
head1 "10. İstemciye secret sızmıyor"
################################################################################
# Sayfanın tamamı indirilir ve secret'a benzeyen her şey aranır. Bu, "servis
# rolü anahtarı tarayıcıya asla gitmez" kuralının kanıtı.
curl -sS "$BASE/" -o "$WORK/sayfa.html"
echo "  indirilen sayfa: $(wc -c < "$WORK/sayfa.html") bayt"

leak_check() {
  if grep -qE "$1" "$WORK/sayfa.html"; then
    fail "$2 — SAYFADA BULUNDU"
  else
    pass "$2"
  fi
}
leak_check 'service_role'                  "service_role geçmiyor"
leak_check 'eyJ[A-Za-z0-9_-]{10,}'         "JWT benzeri dizge yok (anon/servis anahtarı)"
leak_check 'supabase\.co'                  "Supabase host adresi yok"
# Aranan sey degisken ADI degil, ona ATANMIS bir deger. Yalin ad fazla genis
# bir olcut: index.html'de kisitli modu anlatan bir yorum satiri
# ("SUPABASE_ANON_KEY yok") bu kontrolu yanlis yere kirmiziya dusuruyordu.
# Gercek bir sizinti anahtari bir degere baglar (SUPABASE_ANON_KEY = "eyJ...",
# "SUPABASE_ANON_KEY":"..." gibi); desen artik o bagi ariyor.
leak_check 'SUPABASE_[A-Z_]*KEY[\"'"'"']?[[:space:]]*[:=]' "anahtar bir degere atanmiyor"
leak_check 'UPSTASH_'                      "Upstash değişkeni yok"
leak_check 'localStorage\.setItem\([^)]*token' "token localStorage'a yazılmıyor"

# Kimlik uçlarının yanıtları da secret taşımamalı.
api "$JAR_A" GET /api/auth/me
grep -qE 'eyJ[A-Za-z0-9_-]{10,}|service_role' "$BODY" \
  && fail "me yanıtında secret var" || pass "me yanıtında secret yok"

################################################################################
head1 "8. Temizlik — bırakılan tüm kayıtlar siliniyor"
################################################################################
for jar in "$JAR_A" "$JAR_B" "$JAR_C"; do
  api "$jar" DELETE "/api/history?all=1"
  echo "  $(basename "$jar"): $(cat "$BODY")"
  api "$jar" GET /api/history
  LEFT=$(jq -r '.items|length' "$BODY")
  check "$LEFT" "0" "$(basename "$jar") geçmişi boşaltıldı"
done

################################################################################
printf '\n\033[1m== SONUÇ ==\033[0m\n'
if [ "$FAILED" = "0" ]; then
  echo "TÜM KONTROLLER GEÇTİ"
else
  echo "EN AZ BİR KONTROL BAŞARISIZ"
fi
exit "$FAILED"
