#!/usr/bin/env bash
#
# Kayıt ucunun TEK bir çağrıyla teşhisi.
#
# Neden var: üretimde kayıt bozulduğunda elimizde GoTrue'nun neden reddettiğini
# gösteren hiçbir şey yoktu ve teşhis için kullanıcıdan tekrar denemesini
# istemek zorunda kaldık. Bu betik o bağımlılığı kaldırıyor.
#
# Uca TEK istek atar ve dönen HTTP durumu ile hata kodunu yazar. Sunucu
# tarafındaki ayrıntılı kayıt (gotrue_code) Vercel çalışma zamanı günlüğüne
# düşer; bu betik hangi anı arayacağınızı da söyler.
#
# UYARI: kayıt BAŞARILI olursa gerçek bir hesap açılır ve gerçek bir onay
# e-postası gider. Bu yüzden hedef üretimse ayrıca CONFIRM=evet gerekir ve
# betik hesabın temizlenmesi gerektiğini açıkça hatırlatır.
#
# Gerekli:
#   BASE        hedef adres
#   TEST_EMAIL  kullanılacak e-posta (uydurulmaz — çağıran verir)
#   BYPASS      (preview) Vercel Protection Bypass for Automation
#   CONFIRM     (yalnızca üretim hedefi için) 'evet'

set -uo pipefail

BASE="${BASE:?BASE gerekli}"
BYPASS="$(printf '%s' "${BYPASS:-}" | tr -d '[:space:]')"
CONFIRM="${CONFIRM:-}"
MODE="${MODE:-signup}"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
BODY="$WORK/body.json"

istek() {  # istek <yol> <govde>
  local a=(-sS -o "$BODY" -w '%{http_code}' -m 30 -X POST
           -H 'Content-Type: application/json' --data "$2")
  [ -n "$BYPASS" ] && a+=(-H "x-vercel-protection-bypass: $BYPASS")
  curl "${a[@]}" "$BASE$1" 2>/dev/null
}

# ---------------------------------------------------------------------------
# ANAHTAR MODU — hesap AÇMAZ, e-posta GÖNDERMEZ.
#
# Anon anahtarının geçerli olup olmadığını, hiçbir yan etki bırakmadan sınar:
# geçersiz bir bağlantı koduyla doğrulama istenir.
#   anahtar geçerli   → GoTrue "bu kod geçersiz" der      → link_invalid
#   anahtar geçersiz  → GoTrue isteği değerlendirmez      → auth_misconfigured
#
# Neden ayrı mod: kayıt denemesi, anahtar düzeltilmişse gerçek bir hesap açar
# ve o hesabı silmek için burada yetki yok. Durum kontrolünün yan etkisi
# olmamalı.
if [ "$MODE" = "key" ]; then
  printf '\033[1mAnon anahtarı geçerlilik kontrolü\033[0m\n'
  printf 'Hedef : %s\n' "$BASE"
  printf 'Zaman : %s\n\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')"

  STATUS="$(istek /api/auth/verify '{"token_hash":"gecersiz-kod","type":"recovery"}')"
  KOD="$(jq -r '.error.code // "-"' "$BODY" 2>/dev/null || echo '?')"
  printf 'HTTP durumu : %s\n' "$STATUS"
  printf 'Kod         : %s\n\n' "$KOD"

  case "$KOD" in
    auth_misconfigured)
      printf '\033[31mANAHTAR GEÇERSİZ\033[0m  GoTrue anahtarı reddediyor.\n'
      printf 'Kayıt ve giriş bu haldeyken TAMAMEN çalışmaz.\n'
      printf 'Supabase > Settings > API > anon anahtarını Vercel Production ile karşılaştırın.\n'
      exit 1 ;;
    link_invalid)
      printf '\033[32mANAHTAR GEÇERLİ\033[0m  GoTrue anahtarı kabul ediyor.\n'
      printf 'Bağlantı kodu beklendiği gibi reddedildi; kimlik servisi ayakta.\n'
      exit 0 ;;
    *)
      printf '\033[33mBELİRSİZ\033[0m  Beklenmeyen kod. Yanıt: %s\n' "$(head -c 300 "$BODY")"
      exit 1 ;;
  esac
fi

TEST_EMAIL="${TEST_EMAIL:?TEST_EMAIL gerekli (MODE=signup icin)}"

case "$BASE" in
  *cyberlionai.com*)
    if [ "$CONFIRM" != "evet" ]; then
      printf '\033[31mDURDURULDU\033[0m  Hedef üretim. Başarılı bir kayıt gerçek hesap açar\n'
      printf '            ve gerçek e-posta gönderir. Bilerek yapıyorsanız CONFIRM=evet verin.\n'
      exit 2
    fi
    printf '\033[33mUYARI\033[0m  Hedef ÜRETİM. Kayıt başarılı olursa açılan hesabın silinmesi gerekir.\n\n'
    ;;
esac

# Sifre burada uretiliyor ve HICBIR YERE yazilmiyor: ne loga, ne ciktiya, ne
# workflow girdisine. Kayit basarili olursa hesap zaten silinecek.
PW="Probe-$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')-$$"

printf '\033[1mKayıt ucu teşhisi\033[0m\n'
printf 'Hedef  : %s\n' "$BASE"
printf 'Zaman  : %s\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
printf 'E-posta: %s\n\n' "$(printf '%s' "$TEST_EMAIL" | sed 's/\(.\{2\}\).*@/\1***@/')"

args=(-sS -o "$BODY" -w '%{http_code}' -m 30 -X POST
      -H 'Content-Type: application/json'
      --data "{\"email\":\"$TEST_EMAIL\",\"password\":\"$PW\"}")
[ -n "$BYPASS" ] && args+=(-H "x-vercel-protection-bypass: $BYPASS")

STATUS="$(curl "${args[@]}" "$BASE/api/auth/register" 2>/dev/null)"

printf 'HTTP durumu : %s\n' "$STATUS"
printf 'Yanıt       : %s\n\n' "$(head -c 400 "$BODY")"

KOD="$(jq -r '.error.code // (if .ok then "-" else "?" end)' "$BODY" 2>/dev/null || echo '?')"

case "$STATUS" in
  200)
    ONAY="$(jq -r '.needsConfirmation' "$BODY" 2>/dev/null)"
    printf '\033[32mKAYIT ÇALIŞIYOR\033[0m  needsConfirmation=%s\n' "$ONAY"
    printf '\033[33mTEMİZLİK GEREKLİ\033[0m  Bu hesap açıldı; Supabase üzerinden silinmeli.\n'
    ;;
  400)
    printf '\033[31mKAYIT REDDEDİLDİ\033[0m  kod=%s\n' "$KOD"
    printf 'Bu kod istemciye donen koddur. GoTrue kendi kodunu sunucu gunluguna yazar:\n'
    printf '  auth signup failed: http=... gotrue_code=... mapped=...\n'
    ;;
  503)
    printf '\033[31mKAYIT REDDEDİLDİ (bizim tarafımızda)\033[0m  kod=%s\n' "$KOD"
    printf 'Sunucu günlüğünde gotrue_code satırı gerçek sebebi gösterir.\n'
    ;;
  429) printf '\033[33mHIZ SINIRI\033[0m  kod=%s — bir süre sonra tekrar deneyin.\n' "$KOD" ;;
  000) printf '\033[31mULAŞILAMADI\033[0m  Bypass reddedilmiş veya adres yanlış olabilir.\n' ;;
  *)   printf '\033[31mBEKLENMEYEN\033[0m  durum=%s kod=%s\n' "$STATUS" "$KOD" ;;
esac

printf '\nSunucu günlüğünü şu an aralığında arayın: %s\n' "$(date -u '+%H:%M')"
