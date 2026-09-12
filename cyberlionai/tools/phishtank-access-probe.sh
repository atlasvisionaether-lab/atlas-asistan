#!/usr/bin/env bash
#
# PhishTank erişim durumunu ve başvuru yolunu ÖLÇER.
#
#   bash cyberlionai/tools/phishtank-access-probe.sh
#
# NEDEN VAR
#
# PhishTank'in anahtarsız toplu indirmesi kapandı (ölçüldü: HTTP 404 + JPEG,
# koşu 34668244003). Anahtarlı erişime başvuracaksak başvurunun nereden ve
# nasıl yapıldığını TAHMİN ETMEK yerine kaynağın kendi sayfasından okumak
# gerekiyor — sayfa değişmiş, kapanmış ya da yönlendiriliyor olabilir.
#
# Geliştirme ortamının giden bağlantısı phishtank.org'a çıkmıyor; bu yüzden
# ölçüm GitHub Actions üzerinden yapılıyor.
#
# Salt-okunur: hiçbir kayıt oluşturmaz, hiçbir yere üye olmaz, form
# göndermez. Yalnızca kamuya açık sayfaları indirip metnini yazar.

set -uo pipefail

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
UA="CyberLionAI-AccessProbe/1.0 (+https://www.cyberlionai.com)"

head1() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
note()  { printf '   %s\n' "$1"; }

# Sayfayi indirip OKUNUR metne cevirir. Etiketler atiliyor, bosluk sadelesiyor.
metin() {
  sed -e 's/<script[^>]*>.*<\/script>//gI' -e 's/<style[^>]*>.*<\/style>//gI' \
      -e 's/<[^>]*>/ /g' "$1" 2>/dev/null \
    | sed -e 's/&nbsp;/ /g' -e 's/&amp;/\&/g' -e 's/&quot;/"/g' -e "s/&#39;/'/g" \
    | tr -s ' \t' ' ' | sed '/^ *$/d'
}

yokla() {  # <etiket> <url>
  local etiket="$1" url="$2"
  local kod tur boyut son
  son="$(curl -sSL -m 45 -A "$UA" -o "$WORK/s.html" -D "$WORK/s.bas" \
         -w '%{http_code} %{content_type} %{size_download} %{url_effective}' \
         "$url" 2>/dev/null)" || son="000 - 0 -"
  kod="$(printf '%s' "$son" | cut -d' ' -f1)"
  tur="$(printf '%s' "$son" | cut -d' ' -f2)"
  boyut="$(printf '%s' "$son" | cut -d' ' -f3)"
  printf '   %-26s HTTP %-3s  %8s bayt  %s\n' "$etiket" "$kod" "$boyut" "$tur"
  local varis; varis="$(printf '%s' "$son" | cut -d' ' -f4-)"
  [ "$varis" != "$url" ] && note "  → yönlendi: $varis"

  if [ "$kod" = "200" ] && printf '%s' "$tur" | grep -qi 'html\|text'; then
    # Anahtar/basvuru gecen satirlari yaz. Sayfanin tamamini dokmuyoruz;
    # ilgili cumleler yeterli ve kayit okunabilir kaliyor.
    local bulgu
    bulgu="$(metin "$WORK/s.html" \
      | grep -iE 'api key|application key|app key|register|sign up|account|apply|request access|rate limit|per hour|no longer|discontinu|suspend|unavailable|closed|retired|deprecat' \
      | head -14)"
    if [ -n "$bulgu" ]; then
      note "  ilgili satırlar:"
      printf '%s\n' "$bulgu" | cut -c1-200 | sed 's/^/       /'
    else
      note "  ilgili anahtar sözcük bulunamadı; sayfanın ilk satırları:"
      metin "$WORK/s.html" | head -6 | cut -c1-200 | sed 's/^/       /'
    fi
  elif [ "$kod" != "200" ]; then
    note "  gövde türü: $(file -b "$WORK/s.html" 2>/dev/null || echo bilinmiyor)"
  fi
  printf '\n'
}

printf '\033[1mPhishTank erişim ölçümü\033[0m\n'
printf 'Zaman: %s\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')"

head1 "1. Geliştirici ve kayıt sayfaları"
yokla "developer_info"  "https://phishtank.org/developer_info.php"
yokla "api_info"        "https://phishtank.org/api_info.php"
yokla "register"        "https://phishtank.org/register.php"
yokla "ana sayfa"       "https://phishtank.org/"
yokla "faq"             "https://phishtank.org/faq.php"

head1 "2. İndirme uçları — anahtarsız"
# Kapali oldugu zaten olculdu; burada durumun DEVAM ettigi teyit ediliyor.
for u in \
  "https://data.phishtank.com/data/online-valid.json" \
  "https://data.phishtank.com/data/online-valid.csv" \
  "http://data.phishtank.com/data/online-valid.json"
do
  KOD="$(curl -sS -m 45 -A "$UA" -o "$WORK/d.bin" -w '%{http_code} %{content_type}' "$u" 2>/dev/null)" || KOD="000 -"
  printf '   %-58s %s  %s bayt\n' "${u#http*://}" "$KOD" "$(wc -c < "$WORK/d.bin" 2>/dev/null || echo 0)"
done

head1 "Not"
note "Salt-okunur ölçüm. Hiçbir form gönderilmedi, hiçbir hesap açılmadı."
note "Başvuru kararı ve kayıt işlemi insana aittir."
