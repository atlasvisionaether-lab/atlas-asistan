#!/usr/bin/env bash
#
# PhishTank yerine kullanılabilecek ADAY beslemeleri ölçer.
#
#   bash cyberlionai/tools/candidate-feeds-probe.sh
#
# NEDEN VAR
#
# PhishTank'in anahtarsız indirmesi kapandı, yeni kullanıcı kaydı da kapalı —
# yani anahtar yolu şimdilik ölü. Yerine kaynak ararken "OpenPhish'te ülke var
# mı?" gibi soruları hafızadan yanıtlamak bu depoda daha önce hataya yol açtı.
# Bu betik her adayı indirir ve KARAR İÇİN GEREKEN dört şeyi ölçer:
#
#   1. Erişilebilir mi (anahtarsız, HTTP durumu ve gerçek gövde türü)
#   2. Ülke bilgisi var mı — beslemenin KENDİ alanında
#   3. Yoksa IP var mı — bizim RIR tablomuzla ülkeye çevrilebilir mi
#   4. Zaman damgası var mı — 1s/24s/7g filtresini besleyebilir mi
#
# Ayrıca kullanım şartları sayfası yoklanıyor: ticari bir üründe yayınlayacağımız
# veri için lisans, teknik uygunluktan daha belirleyici olabilir.
#
# Salt-okunur: hiçbir hesap açmaz, form göndermez, dosya değiştirmez.

set -uo pipefail

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
UA="CyberLionAI-FeedProbe/1.0 (+https://www.cyberlionai.com)"
AZAMI=$((25 * 1024 * 1024))   # tek adaydan indirilecek üst sınır

head1() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
note()  { printf '   %s\n' "$1"; }

# Ülke kodu / IP / zaman damgası gibi duran alan adları.
ULKESI='country|cc|geo|nation'
IPSI='^ip$|ip_address|ipv4|addr|resolved_ip|host_ip'
ZAMANSI='seen|time|date|added|updated|online|created|submit|verif|timestamp'

printf '\033[1mAday besleme ölçümü\033[0m\n'
printf 'Zaman: %s\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
printf 'Amaç : PhishTank yerine kullanılabilecek, anahtarsız ve coğrafi kaynak bulmak\n'

# ---------------------------------------------------------------------------
# Tek bir adayı indirip özetler.
#   $1 etiket   $2 url   $3 beklenen tür (json|csv|txt)
# ---------------------------------------------------------------------------
olc() {
  local etiket="$1" url="$2" beklenen="$3"
  local dosya="$WORK/$etiket.dat"
  local kod tur boyut

  head1 "$etiket"
  note "adres: $url"

  # Akıştan kırpılıyor: bazı beslemeler çok büyük ve Range başlığını
  # uygulamıyor (PhishTank'te ölçüldü). head borusu kapatınca curl duruyor.
  curl -sSL -m 90 -A "$UA" -D "$WORK/$etiket.bas" "$url" 2>/dev/null \
    | head -c "$AZAMI" > "$dosya" 2>/dev/null || :

  kod="$(grep -i '^HTTP/' "$WORK/$etiket.bas" 2>/dev/null | tail -1 | awk '{print $2}')"
  tur="$(grep -i '^content-type:' "$WORK/$etiket.bas" 2>/dev/null | tail -1 \
         | cut -d: -f2- | tr -d '\r' | sed 's/^ *//')"
  boyut="$(wc -c < "$dosya" 2>/dev/null || echo 0)"
  note "HTTP ${kod:-000}  ${boyut} bayt  ${tur:-bilinmiyor}"

  if [ "${boyut:-0}" -lt 50 ]; then
    note "\033[31mKULLANILAMAZ\033[0m — gövde boş ya da çok küçük"
    note "gerçek tür: $(file -b "$dosya" 2>/dev/null || echo bilinmiyor)"
    return
  fi

  # Gelen gerçekten beklenen tür mü? PhishTank'te JSON yerine JPEG gelmişti;
  # "HTTP 200" tek başına yeterli bir kanıt değil.
  note "gerçek tür: $(file -b "$dosya" 2>/dev/null | cut -c1-90)"

  case "$beklenen" in
    json) ozet_json "$dosya" ;;
    csv)  ozet_csv  "$dosya" ;;
    *)    ozet_duz  "$dosya" ;;
  esac
}

ozet_json() {
  local dosya="$1" ornek=""
  if jq -e . "$dosya" >/dev/null 2>&1; then
    local kok; kok="$(jq -r 'type' "$dosya")"
    note "kök tür: $kok"
    if [ "$kok" = "array" ]; then
      note "kayıt sayısı: $(jq 'length' "$dosya")"
      ornek="$(jq -c '.[0] // {}' "$dosya" 2>/dev/null)"
    else
      # Kok nesne: yaygin sarmalayicilari dene, yoksa ilk deger.
      ornek="$(jq -c '(.data[0]? // .urls[0]? // .results[0]? // (to_entries[0].value)) // {}' \
               "$dosya" 2>/dev/null)"
      # urlhaus gibi deger DIZI ise ilk elemani al.
      ornek="$(printf '%s' "$ornek" | jq -c 'if type=="array" then (.[0] // {}) else . end' 2>/dev/null)"
    fi
  else
    # OLCULDU (kosu 34702409550): Spamhaus DROP satir-basina-JSON (NDJSON).
    # Tumu tek JSON olarak ayristirilamaz; ilk gecerli satir ornek alinir.
    local satir
    satir="$(grep -m1 '^{' "$dosya" 2>/dev/null)"
    if [ -n "$satir" ] && printf '%s' "$satir" | jq -e . >/dev/null 2>&1; then
      note "kök tür: satır-başına-JSON (NDJSON)"
      note "satır sayısı (kırpılmış gövdede): $(wc -l < "$dosya")"
      ornek="$satir"
    else
      note "\033[33mJSON olarak ayrıştırılamadı\033[0m (kırpılmış ya da farklı biçim)"
      note "ilk 200 bayt: $(head -c 200 "$dosya" | tr -d '\n\r')"
      return
    fi
  fi
  note "örnek kayıt: $(printf '%s' "$ornek" | cut -c1-300)"
  alan_tara "$(printf '%s' "$ornek" \
    | jq -r 'if type=="object" then (keys_unsorted | join(" ")) else "" end' 2>/dev/null)"
}

ozet_csv() {
  local dosya="$1"
  note "ilk satır (başlık): $(head -1 "$dosya" | cut -c1-220)"
  note "ikinci satır       : $(sed -n 2p "$dosya" | cut -c1-220)"
  note "satır sayısı (kırpılmış gövdede): $(wc -l < "$dosya")"
  alan_tara "$(head -1 "$dosya" | tr ',;' '  ' | tr -d '"')"
}

ozet_duz() {
  local dosya="$1"
  note "ilk üç satır:"
  head -3 "$dosya" | cut -c1-160 | sed 's/^/     /'
  note "satır sayısı (kırpılmış gövdede): $(wc -l < "$dosya")"
  # Duz listede alan adi yok; icerikten cikarim yapiliyor.
  if grep -qE '^[0-9]{1,3}(\.[0-9]{1,3}){3}' "$dosya"; then
    note "\033[32mIP listesi\033[0m — ülke RIR tablosuyla çözülebilir"
  else
    note "IP satırı görülmedi; muhtemelen URL/alan adı listesi"
  fi
  if grep -qE '[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}' "$dosya"; then
    note "zaman damgası gibi duran satır VAR"
  else
    note "zaman damgası YOK"
  fi
  # Ciplak IP tasiyan URL orani: cozulebilir cografi verim tahmini.
  local toplam ipli
  toplam="$(wc -l < "$dosya")"
  ipli="$(grep -cE '://[0-9]{1,3}(\.[0-9]{1,3}){3}' "$dosya" || true)"
  [ "${toplam:-0}" -gt 0 ] && note "çıplak IP taşıyan satır: $ipli / $toplam"
}

# Alan adlarindan ulke / IP / zaman tasiyip tasimadigini soyler.
alan_tara() {
  local alanlar="$1"
  [ -z "$alanlar" ] && { note "alan adı çıkarılamadı"; return; }
  # OLCULDU (kosu 34702409550): alan listesi bozuk geldiginde bu fonksiyon
  # yuzlerce satir basip DIGER adaylarin sonuclarini kayittan tasirdi. Liste
  # artik kirpiliyor: olcum, kendi ciktisini okunamaz hale getirmemeli.
  local dizi; dizi="$(printf '%s\n' $alanlar | head -40)"
  note "alanlar: $(printf '%s' "$alanlar" | cut -c1-220)"
  local u i z
  u="$(printf '%s\n' "$dizi" | grep -iE "$ULKESI"  | head -5 | tr '\n' ' ')"
  i="$(printf '%s\n' "$dizi" | grep -iE "$IPSI"    | head -5 | tr '\n' ' ')"
  z="$(printf '%s\n' "$dizi" | grep -iE "$ZAMANSI" | head -5 | tr '\n' ' ')"
  [ -n "$u" ] && note "  \033[32mÜLKE alanı\033[0m : $u" || note "  ülke alanı  : YOK"
  [ -n "$i" ] && note "  \033[32mIP alanı\033[0m    : $i" || note "  IP alanı    : YOK"
  [ -n "$z" ] && note "  \033[32mZAMAN alanı\033[0m : $z" || note "  zaman alanı : YOK"
}

# ---------------------------------------------------------------------------
# Adaylar
# ---------------------------------------------------------------------------
olc "openphish"      "https://openphish.com/feed.txt"                                  txt
olc "phishstats-csv" "https://phishstats.info/phish_score.csv"                         csv
olc "phishstats-api" "https://phishstats.info:2096/api/phishing?_size=5"               json
olc "threatfox"      "https://threatfox.abuse.ch/export/json/recent/"                  json
olc "urlhaus-full"   "https://urlhaus.abuse.ch/downloads/json_online/"                 json
olc "blocklist-de"   "https://lists.blocklist.de/lists/all.txt"                        txt
olc "spamhaus-drop"  "https://www.spamhaus.org/drop/drop_v4.json"                      json

# ---------------------------------------------------------------------------
head1 "Kullanım şartları"
# Ticari bir uruende yayinlanacak veri icin lisans, teknik uygunluktan daha
# belirleyici olabilir. Karar insana ait; burada yalnizca sayfalar yoklanıyor.
for u in \
  "https://openphish.com/terms.html" \
  "https://openphish.com/faq.html" \
  "https://phishstats.info/" \
  "https://threatfox.abuse.ch/faq/" \
  "https://www.spamhaus.org/drop/"
do
  KOD="$(curl -sSL -m 30 -A "$UA" -o "$WORK/t.html" -w '%{http_code}' "$u" 2>/dev/null)" || KOD=000
  printf '   %-42s HTTP %s  %s bayt\n' "${u#https://}" "$KOD" "$(wc -c < "$WORK/t.html" 2>/dev/null || echo 0)"
  if [ "$KOD" = "200" ]; then
    sed -e 's/<[^>]*>/ /g' "$WORK/t.html" 2>/dev/null | tr -s ' \t' ' ' | sed '/^ *$/d' \
      | grep -iE 'commercial|non-commercial|licen[cs]|redistribut|attribution|free to use|may not|permitted|terms of (use|service)' \
      | head -5 | cut -c1-190 | sed 's/^/       /'
  fi
done

head1 "Not"
note "Salt-okunur ölçüm. Hiçbir hesap açılmadı, form gönderilmedi."
note "Lisans yorumu bu betiğin işi değil; satırlar olduğu gibi aktarılıyor."
