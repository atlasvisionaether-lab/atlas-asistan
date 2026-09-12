#!/usr/bin/env bash
#
# Beslemelerdeki ZAMAN DAMGALARINI ölçer.
#
#   bash cyberlionai/tools/time-probe.sh
#
# NEDEN VAR
#
# Haritadaki 1s / 24s / 7g filtresi yalnızca urlhaus'a bağlıydı ve urlhaus
# arayüzün sayaç panelinden düştüğünde filtre sessizce hiçbir şey yapmaz oldu.
# Filtreyi bütün kaynaklara yaymadan önce hangi kaynağın gerçekten zaman
# damgası taşıdığını ÖLÇMEK gerekiyor — alan adını tahmin edip ayrıştırıcı
# yazmak bu depoda daha önce de hataya yol açtı.
#
# Salt-okunur: yalnızca kamuya açık beslemeleri indirir, hiçbir yere yazmaz.

set -uo pipefail

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
UA="CyberLionAI-TimeProbe/1.0 (+https://www.cyberlionai.com)"

head1() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
note()  { printf '   %s\n' "$1"; }

# Zaman damgasi gibi duran alan adlari. Bulunanlar acikca yaziliyor; bulunmayan
# icin "yok" demek de bir olcum sonucudur.
ZAMANSI='seen|time|date|added|updated|online|created|submit|verif'

cek() {  # <ad> <url> <hedef>
  local kod
  kod="$(curl -sSL -m 60 -A "$UA" -o "$3" -w '%{http_code}' "$2" 2>/dev/null)" || kod=000
  printf '%s' "$kod"
}

printf '\033[1mBesleme zaman damgası ölçümü\033[0m\n'
printf 'Zaman: %s\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# ---------------------------------------------------------------------------
head1 "1. feodo (ipblocklist.json)"
KOD="$(cek feodo 'https://feodotracker.abuse.ch/downloads/ipblocklist.json' "$WORK/feodo.json")"
note "HTTP $KOD  $(wc -c < "$WORK/feodo.json") bayt"
if [ "$KOD" = "200" ] && jq -e 'type == "array"' "$WORK/feodo.json" >/dev/null 2>&1; then
  note "alanlar: $(jq -r '[.[0] // {} | keys[]] | join(", ")' "$WORK/feodo.json")"
  note "zaman gibi duranlar:"
  jq -r --arg re "$ZAMANSI" '[.[0] // {} | keys[]] | map(select(test($re; "i")))[]' \
    "$WORK/feodo.json" 2>/dev/null | while read -r alan; do
      printf '     %-14s örnek: %s\n' "$alan" "$(jq -r --arg a "$alan" '.[0][$a] // "-"' "$WORK/feodo.json")"
    done
  note "kayıt sayısı: $(jq 'length' "$WORK/feodo.json")"
  # Hangi alan filtreyi besleyebilir: her biri icin pencere dagilimi.
  for alan in first_seen last_online; do
    note "$alan pencereleri: $(jq -r --arg a "$alan" '
      (now) as $n
      | [ .[] | (.[$a] // "") | select(type=="string" and . != "")
          | select(length >= 19) | (.[0:19] | sub(" "; "T") + "Z")
          | try fromdateiso8601 catch empty ] as $t
      | "1s=\([$t[]|select($n - . <= 3600)]|length)  " +
        "24s=\([$t[]|select($n - . <= 86400)]|length)  " +
        "7g=\([$t[]|select($n - . <= 604800)]|length)  " +
        "ayrıştırılabilen=\($t|length)"
    ' "$WORK/feodo.json" 2>/dev/null || echo 'okunamadı')"
  done
else
  note "beslemeye ulaşılamadı ya da biçim beklenenden farklı"
fi

# ---------------------------------------------------------------------------
head1 "2. urlhaus (json_recent)"
KOD="$(cek urlhaus 'https://urlhaus.abuse.ch/downloads/json_recent/' "$WORK/urlhaus.json")"
note "HTTP $KOD  $(wc -c < "$WORK/urlhaus.json") bayt"
if [ "$KOD" = "200" ] && jq -e 'type == "object"' "$WORK/urlhaus.json" >/dev/null 2>&1; then
  note "kayıt alanları: $(jq -r '[to_entries[0].value[0] // {} | keys[]] | join(", ")' "$WORK/urlhaus.json")"
  note "dateadded örnek: $(jq -r 'to_entries[0].value[0].dateadded // "-"' "$WORK/urlhaus.json")"
  note "kayıt sayısı: $(jq 'length' "$WORK/urlhaus.json")"
  note "dateadded pencereleri: $(jq -r '
    (now) as $n
    | [ .[] | (if type=="array" then .[0] else . end) | (.dateadded // "")
        | select(type=="string" and . != "")
        | select(length >= 19) | (.[0:19] | sub(" "; "T") + "Z")
          | try fromdateiso8601 catch empty ] as $t
    | "1s=\([$t[]|select($n - . <= 3600)]|length)  " +
      "24s=\([$t[]|select($n - . <= 86400)]|length)  " +
      "7g=\([$t[]|select($n - . <= 604800)]|length)  " +
      "ayrıştırılabilen=\($t|length)"
  ' "$WORK/urlhaus.json" 2>/dev/null || echo 'okunamadı')"
fi

# ---------------------------------------------------------------------------
head1 "2b. urlhaus json_recent  vs  json_online"
# Uretim json_recent KULLANIYOR. json_online'a gecmeyi onermistim; bu olcum
# onerimi curuttu (kosu 34703503182) ve degisiklik geri alindi:
#
#   json_recent  12.637 kayit   ciplak IP tasiyan 11.298   24s=301  7g=2.912
#   json_online  13.861 kayit   ciplak IP tasiyan  5.459   24s=212  7g=  729
#
# Kayit sayisi artiyor ama ULKESI COZULEBILEN kayit yariya dusuyor; ulkeyi
# URL'deki ciplak IP'den cozuyoruz. Bolum, karar tekrar gundeme geldiginde
# ayni olcumu yeniden yapabilmek icin duruyor.
for UC in json_recent json_online; do
  KOD="$(cek "urlhaus-$UC" "https://urlhaus.abuse.ch/downloads/$UC/" "$WORK/$UC.json")"
  if [ "$KOD" = "200" ] && jq -e 'type == "object"' "$WORK/$UC.json" >/dev/null 2>&1; then
    note "$UC: $(wc -c < "$WORK/$UC.json") bayt  $(jq 'length' "$WORK/$UC.json") kayıt"
    note "  $(jq -r '
      (now) as $n
      | [ .[] | (if type=="array" then .[0] else . end) ] as $k
      | [ $k[] | (.dateadded // "") | select(type=="string" and . != "")
          | select(length >= 19) | (.[0:19] | sub(" "; "T") + "Z")
          | try fromdateiso8601 catch empty ] as $t
      | "1s=\([$t[]|select($n - . <= 3600)]|length)  " +
        "24s=\([$t[]|select($n - . <= 86400)]|length)  " +
        "7g=\([$t[]|select($n - . <= 604800)]|length)  " +
        "damgali=\($t|length)  " +
        "çıplak IP taşıyan=\([$k[]|select(.url|test("://[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+"))]|length)"
    ' "$WORK/$UC.json" 2>/dev/null || echo 'okunamadı')"
  else
    note "$UC: HTTP $KOD — okunamadı"
  fi
done

# ---------------------------------------------------------------------------
head1 "3. torexit (torbulkexitlist)"
KOD="$(cek torexit 'https://check.torproject.org/torbulkexitlist' "$WORK/tor.txt")"
note "HTTP $KOD  $(wc -c < "$WORK/tor.txt") bayt"
if [ "$KOD" = "200" ]; then
  note "ilk üç satır:"
  head -3 "$WORK/tor.txt" | sed 's/^/     /'
  # Duz IP listesinde zaman damgasi olmasi beklenmiyor; yine de ARANIYOR ki
  # "yok" demek olcum olsun, varsayim degil.
  if grep -Eq '[0-9]{4}-[0-9]{2}-[0-9]{2}' "$WORK/tor.txt"; then
    note "DİKKAT: tarih gibi duran satır var:"
    grep -Eo '[0-9]{4}-[0-9]{2}-[0-9]{2}[^ ]*' "$WORK/tor.txt" | head -3 | sed 's/^/     /'
  else
    note "tarih içeren satır YOK — düz IP listesi, zaman filtresi desteklenemez"
  fi
fi

# ---------------------------------------------------------------------------
head1 "4. phishtank (online-valid.json)"
# Besleme 40 MB'tan buyuk; tamami indirilmiyor. Ilk birkac megabayt bir girdiyi
# eksiksiz icermeye fazlasiyla yeter ve alan adlarini gormek icin o kadari lazim.
# OLCULDU (kosu 34667892768): `-r 0-3000000` araligi sunucu tarafindan
# uygulanmadi, 17 KB geldi ve tek bir girdi bile tamamlanmadi. Bu yuzden
# akistan kirpiliyor: curl indirmeye devam ederken head ilk parcayi alip
# borusu kapaniyor.
curl -sSL -m 120 -A "$UA" -D "$WORK/pt.bas" \
  'https://data.phishtank.com/data/online-valid.json' 2>/dev/null \
  | head -c 3000000 > "$WORK/pt.part" 2>/dev/null || :
note "indirilen parça: $(wc -c < "$WORK/pt.part" 2>/dev/null || echo 0) bayt"
# OLCULDU (kosu 34668079640): 41 MB beklenirken 17.993 bayt geldi. Gelenin NE
# oldugunu bilmeden "besleme kapandi" ya da "kisa geldi" demek tahmin olurdu;
# bu yuzden basliklar ve govdenin basi oldugu gibi yaziliyor.
note "yanıt başlıkları:"
grep -iE '^(HTTP/|content-type|content-length|retry-after|x-|server|location):' \
  "$WORK/pt.bas" 2>/dev/null | head -12 | tr -d '\r' | sed 's/^/     /'
note "gövdenin ilk 300 baytı:"
head -c 300 "$WORK/pt.part" 2>/dev/null | tr -d '\r' | sed 's/^/     /'
printf '\n'
note "gövde türü: $(file -b "$WORK/pt.part" 2>/dev/null || echo bilinmiyor)"
if [ -s "$WORK/pt.part" ]; then
  # Ilk tam girdiyi ayikla: ikinci "phish_id"den oncesini al, son tamamlanmis
  # nesneyi ayristirmayi dene.
  python3 - "$WORK/pt.part" <<'PY'
import json, re, sys
ham = open(sys.argv[1], 'rb').read().decode('utf-8', 'replace')
kesim = [m.start() for m in re.finditer(r'\{\s*"phish_id"', ham)]
if len(kesim) < 2:
    print('   girdi sınırı bulunamadı (parça çok küçük olabilir)')
    sys.exit(0)
parca = ham[kesim[0]:kesim[1]].rstrip().rstrip(',')
try:
    girdi = json.loads(parca)
except Exception as e:
    print('   ilk girdi ayrıştırılamadı: %s' % e)
    print('   ham (ilk 400): %s' % parca[:400])
    sys.exit(0)
print('   girdi alanları: %s' % ', '.join(girdi.keys()))
zamansi = [k for k in girdi if re.search(r'seen|time|date|added|updated|online|created|submit|verif', k, re.I)]
for k in zamansi:
    print('     %-20s örnek: %s' % (k, girdi[k]))
if not zamansi:
    print('   zaman gibi duran alan YOK')
d = girdi.get('details')
if isinstance(d, list) and d:
    print('   details[0] alanları: %s' % ', '.join(d[0].keys()))
    dz = [k for k in d[0] if re.search(r'seen|time|date|added|updated|online|created', k, re.I)]
    for k in dz:
        print('     details.%-14s örnek: %s' % (k, d[0][k]))
PY
fi

head1 "Not"
note "Bu betik yalnızca ölçüm yapar; hiçbir dosyayı değiştirmez."
note "Sonuç, zaman filtresinin hangi kaynaklarda desteklenebileceğini belirler."
