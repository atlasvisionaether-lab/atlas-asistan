#!/usr/bin/env bash
#
# Sertifika makamı ölçümü.
#
#   bash cyberlionai/tools/cert-issuer-probe.sh [alanadi ...]
#
# NEDEN VAR
#
# CAA kaydı yazmadan önce cevaplanması ZORUNLU olan tek soru: sertifikayı
# hangi makam kesiyor? CAA, yetkiyi yazdığınız makamlarla SINIRLAR — yanlış
# makamı yazarsanız bir sonraki yenileme (Vercel'de otomatik) başarısız olur
# ve site sertifikasız kalır. "Vercel genelde Let's Encrypt veriyor" bir
# tahmindir; CAA kaydı tahminle yazılmaz.
#
# Vercel API'si makamı DÖNDÜRMÜYOR: /v5/certs ve /v7/certs/<id> yalnızca
# cns, createdAt, expiresAt ve autoRenew veriyor (11.10.2026'da bakıldı).
# Yani makam yalnızca sunucuyla TLS el sıkışması yapılarak ölçülebilir ve
# bu yüzden bu betik Actions'ta koşuyor — geliştirme kabının çıkışı
# cyberlionai.com'u kapatıyor (CONNECT 403).
#
# Salt-okunur: yalnızca TLS el sıkışması yapar, istek göndermez.

set -uo pipefail

ALANLAR=("$@")
if [ ${#ALANLAR[@]} -eq 0 ]; then
  ALANLAR=(cyberlionai.com www.cyberlionai.com)
fi

KALIN='\033[1m'
SIFIRLA='\033[0m'

printf "${KALIN}Sertifika makamı ölçümü${SIFIRLA}\n"
printf "openssl: %s\n\n" "$(openssl version)"

for alan in "${ALANLAR[@]}"; do
  printf "${KALIN}== %s${SIFIRLA}\n" "$alan"

  # -servername: SNI olmadan Vercel yanlış sertifikayı döndürür.
  pem=$(echo | timeout 20 openssl s_client -connect "$alan:443" \
        -servername "$alan" 2>/dev/null)

  if ! printf '%s' "$pem" | grep -q 'BEGIN CERTIFICATE'; then
    printf "   ÖLÇÜLEMEDİ (el sıkışma başarısız — ağ ya da ad çözümleme)\n\n"
    continue
  fi

  printf '%s' "$pem" | openssl x509 -noout -issuer -subject -dates 2>/dev/null \
    | sed 's/^/   /'

  # CAA'ya yazılacak isim issuer'ın CN'i DEĞİL, makamın CAA kimliğidir
  # (Let's Encrypt → letsencrypt.org, Google Trust Services → pki.goog).
  # Eşlemeyi insan yapsın diye ham issuer satırı yukarıda basılıyor.
  printf "\n"
done

printf "${KALIN}Not${SIFIRLA}: CAA kaydına yazılacak ad, issuer CN'i değil makamın\n"
printf "CAA kimliğidir (Let's Encrypt → letsencrypt.org, GTS → pki.goog).\n"
