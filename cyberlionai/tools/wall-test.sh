#!/usr/bin/env bash
#
# tools/auth-wall.sh icindeki kimlik duvari algilamasinin sinamasi.
#
#   bash tools/wall-test.sh
#
# Iki yonu de sinar: duvar varken yakalamak YETMEZ, duvar yokken sessiz kalmasi
# da gerekir. Yanlis alarm, gecerli bir karsilastirmayi engellerdi.

set -uo pipefail
. "$(dirname "$0")/auth-wall.sh"

GECEN=0; KALAN=0
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

sina() { # <ad> <beklenen: duvar|temiz> <kod> <yonlendirme> <hedef> <basliklar>
  local ad="$1" beklenen="$2" kod="$3" yon="$4" hedef="$5" bas="$6"
  printf '%b' "$bas" > "$TMP/bas"
  local belirti cikan
  if belirti="$(kimlik_duvari "$kod" "$yon" "$TMP/bas" "$hedef")"; then
    cikan=duvar
  else
    cikan=temiz; belirti=""
  fi
  if [ "$cikan" = "$beklenen" ]; then
    printf '  \033[32mGEÇTİ\033[0m  %s%s\n' "$ad" "${belirti:+  ($belirti)}"
    GECEN=$((GECEN + 1))
  else
    printf '  \033[31mKALDI\033[0m  %s — beklenen %s, çıkan %s\n' "$ad" "$beklenen" "$cikan"
    KALAN=$((KALAN + 1))
  fi
}

printf '\033[1mKimlik duvarı yakalanmalı\033[0m\n'
sina "401 döndü"              duvar 401 ""                                  "a.com"            'HTTP/2 401\n'
sina "403 döndü"              duvar 403 ""                                  "a.com"            'HTTP/2 403\n'
sina "WWW-Authenticate var"   duvar 200 ""                                  "a.com"            'HTTP/2 200\nwww-authenticate: Basic\n'
sina "Vercel SSO yönlendirme" duvar 307 "https://vercel.com/sso-api?url=x"  "zayif.vercel.app" 'HTTP/2 307\n'
sina "kurumsal login akışı"   duvar 302 "https://login.microsoftonline.com/x" "a.com"          'HTTP/2 302\n'
sina "SSO çerezi bırakıldı"   duvar 200 ""                                  "a.com"            'HTTP/2 200\nset-cookie: _vercel_sso_nonce=abc; Path=/\n'

printf '\033[1mYanlış alarm olmamalı\033[0m\n'
sina "normal 200"             temiz 200 ""                                  "a.com" 'HTTP/2 200\nset-cookie: oturum=1\n'
sina "apex → www"             temiz 301 "https://www.a.com/"                "a.com" 'HTTP/2 301\n'
sina "aynı adreste yol"       temiz 308 "https://a.com/tr/"                 "a.com" 'HTTP/2 308\n'
sina "kimlik dışı çapraz yön" temiz 302 "https://cdn.b.com/"               "a.com" 'HTTP/2 302\n'

printf '\nGeçen: %s   Kalan: %s\n' "$GECEN" "$KALAN"
[ "$KALAN" -eq 0 ] || exit 1
