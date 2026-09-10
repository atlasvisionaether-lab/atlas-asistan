#!/usr/bin/env bash
#
# Preview doğrulaması — yeni Supabase projesine bağlı preview dağıtımı üzerinde
# gerçek kimlik akışını uçtan uca koşar.
#
# Neden ayrı bir betik: prod-verify.sh üretime bakar ve hesap oluşturmaz.
# Bu betik tam tersini yapar — gerçek kayıt açar, gerçek e-posta gönderir.
# Bu yüzden yalnızca elle, preview'a karşı çalıştırılır.
#
# SSO koruması açık kalır; istekler Vercel'in "Protection Bypass for
# Automation" başlığıyla geçer. Koruma kapatılmaz.
#
# CI'ya hiçbir Supabase veya Upstash secret'ı konmaz: betik yalnızca uygulamanın
# kendi HTTP uçlarıyla konuşur. Veritabanı doğrulaması ve test kullanıcısının
# temizliği ayrıca, Supabase yönetim erişimi olan taraftan yapılır.
#
# İki fazlı:
#   TOKEN_HASH boşsa   → 1. faz: anonim tarama + kayıt, onay e-postası beklenir
#   TOKEN_HASH doluysa → 2. faz: onay → giriş → devir → tarama → geçmiş → PDF
#                                 → çıkış → şifre sıfırlama
#
# Gerekli:
#   BASE          preview adresi
#   BYPASS        Vercel Protection Bypass for Automation değeri
#   TEST_EMAIL    gerçek, erişilebilir posta kutusu
#   TEST_PASSWORD test hesabının şifresi
#   TOKEN_HASH    (2. faz) onay bağlantısındaki token_hash
#   COOKIE_JAR    (2. faz) 1. fazdan taşınan çerez kavanozu

set -uo pipefail

BASE="${BASE:?preview adresi gerekli}"
BYPASS="${BYPASS:?bypass degeri gerekli}"
TEST_EMAIL="${TEST_EMAIL:?test e-posta adresi gerekli}"
TEST_PASSWORD="${TEST_PASSWORD:?test sifresi gerekli}"
# GitHub secret'ine yapistirilirken sona kacan satir sonu/bosluk bypass'i sessizce
# gecersiz kilar; deger zaten alfanumerik oldugu icin bosluklari atmak guvenli.
BYPASS="$(printf '%s' "$BYPASS" | tr -d '[:space:]')"
TOKEN_HASH="${TOKEN_HASH:-}"
# Faz secimi token_hash'e degil, 1. fazin calisma numarasina bagli.
# Kullanici onay baglantisina tarayicidan tiklarsa token tukenir ve
# token_hash bos kalir; ama 2. faz yine de kosabilmeli, cunku login de
# ayni devir kodunu (claimForUser) calistiriyor.
PHASE1_RUN_ID="${PHASE1_RUN_ID:-}"
if [ -n "$PHASE1_RUN_ID" ]; then PHASE=2; else PHASE=1; fi
# Taranacak hedef. Varsayilan kendi alan adimiz; yerel provada degistirilir.
TARGET="${TARGET:-cyberlionai.com}"
COOKIE_JAR="${COOKIE_JAR:-$PWD/preview-cookies.txt}"

FAILED=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILED=1; }
head1() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
check() { if [ "$1" = "$2" ]; then pass "$3 ($2)"; else fail "$3 — beklenen '$2', gelen '$1'"; fi; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
BODY="$WORK/body"; HDR="$WORK/hdr"

# api METHOD PATH [JSON]
api() {
  if [ $# -ge 3 ]; then
    STATUS=$(curl -sS -o "$BODY" -D "$HDR" -w '%{http_code}' \
      -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X "$1" "$BASE$2" \
      -H "x-vercel-protection-bypass: $BYPASS" \
      -H 'content-type: application/json' --data "$3")
  else
    STATUS=$(curl -sS -o "$BODY" -D "$HDR" -w '%{http_code}' \
      -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X "$1" "$BASE$2" \
      -H "x-vercel-protection-bypass: $BYPASS")
  fi
}
hdr() { grep -i "^$1:" "$HDR" | tail -1 | cut -d' ' -f2- | tr -d '\r'; }

# Gizli değerlerin loga düşmemesi için yalnızca maskelenmiş biçim yazdırılır.
mask() { printf '%s' "$1" | sed -E 's/(.{2}).*(.{2})/\1***\2/'; }

echo "Hedef        : $BASE"
echo "Test adresi  : $(printf '%s' "$TEST_EMAIL" | sed -E 's/(.).*(@.*)/\1***\2/')"
echo "Faz          : $([ "$PHASE" = "1" ] && echo '1 (kayit)' \
  || { [ -n "$TOKEN_HASH" ] && echo '2 (onay baglantisi ile)' || echo '2 (giris ile)'; })"
# Degerin kendisi degil, yalnizca uzunlugu: yanlis/eksik secret'i ayirt etmeye yeter.
echo "Bypass       : ${#BYPASS} karakter (Vercel'in urettigi deger 32'dir)"

################################################################################
head1 "0. Erişim ve servis durumu"
################################################################################
# Korumayi iki bicimde gecmeyi deneriz. Baslik bicimi her istekte gonderiliyor;
# ama Vercel bazi yollarda yalnizca sorgu parametresiyle alinan bypass cerezini
# kabul ediyor. Bu on istek cerezi bir kez alir, sonrasinda kavanozdaki cerez
# tum istekleri tasir. Sorgu parametresi loga dusmez; yalnizca sonuc yazilir.
curl -sS -o /dev/null -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  "$BASE/?x-vercel-protection-bypass=$BYPASS&x-vercel-set-bypass-cookie=samesitenone" \
  -H "x-vercel-protection-bypass: $BYPASS" >/dev/null 2>&1 || true
grep -qi '_vercel_jwt' "$COOKIE_JAR" 2>/dev/null \
  && echo "  bypass cerezi alindi" \
  || echo "  bypass cerezi alinamadi - yalnizca baslik bicimi denenecek"

api GET /api/auth/me
check "$STATUS" "200" "preview erişilebilir (SSO bypass çalışıyor)"
if [ "$STATUS" != "200" ]; then
  echo "  Durum   : $STATUS"
  echo "  Location: $(hdr location)"
  echo "  Yanit   : $(head -c 200 "$BODY")"
  echo
  echo "  302 + sso-api/_vercel/sso yonlendirmesi = koruma bypass'i kabul etmedi."
  echo "  Olasi nedenler: GitHub secret'indaki deger Vercel'deki 'Protection Bypass"
  echo "  for Automation' degeriyle birebir ayni degil, ya da Vercel'de bypass hic"
  echo "  olusturulmamis veya yeniden uretilmis."
  exit 1
fi
check "$(jq -r '.available' "$BODY")" "true" "kimlik servisi yapılandırılmış"
check "$(jq -r '.authenticated' "$BODY")" "false" "başlangıçta anonim"
# 1. fazda sunucu yeni bir anonim oturum verir. 2. fazda oturum kavanozdan
# geldiği için sunucu yeniden vermez — bu doğru davranış, o yüzden orada
# kavanozun kendisine bakılır. Fark gözetilmezse 2. faz boş yere kırmızı olur.
if [ "$PHASE" = "1" ]; then
  grep -qi 'cl_sid=' "$HDR" && pass "anonim oturum çerezi verildi" || fail "cl_sid yok"
else
  grep -qi 'cl_sid' "$COOKIE_JAR" 2>/dev/null \
    && pass "1. fazın anonim oturumu taşındı" \
    || fail "çerez kavanozunda cl_sid yok — devir test edilemez"
fi

if [ "$PHASE" = "1" ]; then
  ############################################################################
  head1 "1. FAZ — anonim geçmiş oluştur"
  ############################################################################
  # Devrin gerçekten çalıştığını görebilmek için önce anonim kayıt üretilir.
  for i in 1 2; do
    api POST /api/scan "{\"url\":\"$TARGET\"}"
    check "$STATUS" "200" "anonim tarama $i"
    [ "$i" = "1" ] && echo "  skor: $(jq -r '.score' "$BODY")  kota: $(jq -r '.quota.remaining' "$BODY") kaldı"
  done

  api GET /api/history
  check "$(jq -r '.items|length' "$BODY")" "2" "anonim geçmişte 2 kayıt"

  ############################################################################
  head1 "2. FAZ ÖNCESİ — kayıt (gerçek e-posta gönderilir)"
  ############################################################################
  api POST /api/auth/register "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}"
  echo "  durum: $STATUS  gövde: $(cat "$BODY")"

  if [ "$STATUS" = "503" ] && [ "$(jq -r '.error.code' "$BODY")" = "signup_unavailable" ]; then
    fail "kayıt hâlâ veritabanı tetikleyicisine takılıyor — preview eski projeye bakıyor olabilir"
    exit 1
  fi
  check "$STATUS" "200" "kayıt isteği kabul edildi"
  check "$(jq -r '.needsConfirmation' "$BODY")" "true" "onay e-postası bekleniyor"
  grep -qi 'cl_at=' "$HDR" && fail "onaydan ÖNCE oturum açıldı" || pass "onaydan önce oturum açılmadı"

  # Bypass cerezi (_vercel_jwt) artefakta tasinmaz: preview'a erisim veren bir
  # kimlik bilgisi ve 2. faz onu zaten kendi on istegiyle yeniden aliyor.
  if grep -qi '_vercel_jwt' "$COOKIE_JAR" 2>/dev/null; then
    grep -vi '_vercel_jwt' "$COOKIE_JAR" > "$WORK/jar" && mv "$WORK/jar" "$COOKIE_JAR"
  fi

  echo
  echo "1. faz tamam. Çerez kavanozu: $COOKIE_JAR"
  echo "Onay e-postasındaki token_hash ile 2. fazı çalıştırın."
  [ "$FAILED" = "0" ] && echo "SONUÇ: 1. FAZ GEÇTİ" || echo "SONUÇ: 1. FAZDA HATA"
  exit "$FAILED"
fi

################################################################################
if [ -n "$TOKEN_HASH" ]; then
  head1 "2. FAZ — onay bağlantısı"
  api POST /api/auth/verify "{\"token_hash\":\"$TOKEN_HASH\",\"type\":\"signup\"}"
  check "$STATUS" "200" "onay bağlantısı doğrulandı"
else
  # Onay tarayicidan yapildiysa token tukenmistir. Giris de ayni devir kodunu
  # calistirdigi icin devir yine ucdan uca sinaniyor; yalnizca verify ucunun
  # kendisi bu kosuda kapsam disi kaliyor.
  head1 "2. FAZ — giriş (onay tarayıcıdan yapıldı)"
  api POST /api/auth/login "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}"
  check "$STATUS" "200" "giriş yapıldı"
fi
################################################################################
if [ "$STATUS" != "200" ]; then echo "  gövde: $(cat "$BODY")"; exit 1; fi
CLAIMED=$(jq -r '.claimed' "$BODY")
check "$CLAIMED" "2" "anonim geçmiş hesaba devredildi"
grep -qi 'cl_at=' "$HDR" && pass "oturum açıldı" || fail "oturum çerezi yazılmadı"
grep -i 'set-cookie: cl_at' "$HDR" | grep -qi 'httponly' && pass "HttpOnly" || fail "HttpOnly yok"
grep -i 'set-cookie: cl_at' "$HDR" | grep -qi 'secure'   && pass "Secure"   || fail "Secure yok"

head1 "3. Oturum ve kota"
api GET /api/auth/me
check "$(jq -r '.authenticated' "$BODY")" "true" "giriş yapılmış"
check "$(jq -r '.quota.scope' "$BODY")" "account" "kota hesaba bağlı"
check "$(jq -r '.quota.used' "$BODY")" "2" "devralınan taramalar kotaya işlendi"

head1 "4. Geçmiş ve PDF"
api GET /api/history
check "$(jq -r '.items|length' "$BODY")" "2" "geçmiş hesapta görünüyor"
SCAN_ID=$(jq -r '.items[0].id' "$BODY")

PDF="$WORK/rapor.pdf"
PSTATUS=$(curl -sS -o "$PDF" -D "$HDR" -w '%{http_code}' -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -H "x-vercel-protection-bypass: $BYPASS" "$BASE/api/report?id=$SCAN_ID&lang=tr")
check "$PSTATUS" "200" "PDF indirildi"
check "$(hdr content-type)" "application/pdf" "içerik türü"
head -c 8 "$PDF" | grep -q '%PDF-' && pass "geçerli PDF imzası" || fail "PDF imzası yok"
if command -v pdftotext >/dev/null 2>&1; then
  pdftotext -enc UTF-8 "$PDF" "$WORK/rapor.txt" 2>/dev/null
  for w in "GÜVENLİK SKORU" "RİSK SEVİYESİ" "KONTROL ÖZETİ"; do
    grep -qF "$w" "$WORK/rapor.txt" && pass "Türkçe büyük harf: '$w'" || fail "eksik: '$w'"
  done
fi

head1 "5. Hesap kotası"
api POST /api/scan "{\"url\":\"$TARGET\"}"
check "$STATUS" "200" "3. tarama (hesap)"
check "$(jq -r '.quota.remaining' "$BODY")" "2" "kalan hak 2"

head1 "6. Çıkış ve yeniden giriş"
api POST /api/auth/logout
check "$STATUS" "200" "çıkış"
api GET /api/auth/me
check "$(jq -r '.authenticated' "$BODY")" "false" "artık anonim"
api GET "/api/report?id=$SCAN_ID"
check "$STATUS" "404" "çıkıştan sonra hesabın raporuna erişilemiyor"

api POST /api/auth/login "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}"
check "$STATUS" "200" "şifreyle giriş"
check "$(jq -r '.claimed' "$BODY")" "0" "ikinci devirde 0 kayıt (çift sayım yok)"
api GET /api/history
check "$(jq -r '.items|length' "$BODY")" "3" "geçmiş korunuyor"

head1 "7. Kullanıcı sayımına karşı"
api POST /api/auth/login '{"email":"kesinlikle-yok@cyberlionai-test.invalid","password":"HerhangiBirSifre123"}'
C1=$(jq -r '.error.code' "$BODY")
api POST /api/auth/login "{\"email\":\"$TEST_EMAIL\",\"password\":\"kesinlikle-yanlis-sifre\"}"
C2=$(jq -r '.error.code' "$BODY")
check "$C1" "invalid_credentials" "olmayan hesap"
check "$C2" "$C1" "yanlış şifre AYNI kodu alıyor"

head1 "8. Şifre sıfırlama e-postası"
api POST /api/auth/recover "{\"email\":\"$TEST_EMAIL\"}"
check "$STATUS" "200" "sıfırlama istendi (posta kutusunda görünmeli)"

printf '\n\033[1m== SONUÇ ==\033[0m\n'
if [ "$FAILED" = "0" ]; then
  echo "TÜM KONTROLLER GEÇTİ"
  echo "Test kullanıcısı ($TEST_EMAIL) yeni projede kaldı; temizliği ayrıca onaylanmalı."
else
  echo "EN AZ BİR KONTROL BAŞARISIZ — Production değişikliğine geçilmemeli."
fi
exit "$FAILED"
