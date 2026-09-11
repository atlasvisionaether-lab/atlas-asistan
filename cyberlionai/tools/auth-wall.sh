#!/usr/bin/env bash
#
# Bir hedefin kimlik duvarinin (SSO / giris ekrani / HTTP auth) arkasinda olup
# olmadigini soyler. scanner-compare.sh ve wall-test.sh ayni fonksiyonu
# kullanir — mantik tek yerde dursun, sinama ile betik birbirinden sapmasin.
#
#   kimlik_duvari <http_kodu> <yonlendirme_adresi> <baslik_dosyasi> <hedef_host>
#
# Duvar varsa belirtiyi stdout'a yazar ve 0 doner; yoksa hicbir sey yazmaz ve
# 1 doner.
#
# NEDEN GEREKLI
#
# Observatory ve SSL Labs hedefi ANONIM getirir; bizim kimlik bilgilerimizi
# tasiyamazlar. Hedef korumaliysa uc arac da asil sayfayi degil giris ekranini
# olcer ve karsilastirma tablosu bunu fark etmeden duzgun gorunen bir mutabakat
# orani uretir.
#
# OLCULDU (kosu 34640585480): SSO korumali bir hedefte Observatory
#   strict-transport-security: pass=true  result=hsts-preloaded
#   cookies:                   pass=true  result=cookies-secure-with-httponly...
# dedi; oysa o adresteki fikstur bu basliklarin hicbirini gondermiyordu.
# Olculen sey Vercel'in giris duvariydi. Tablo yine de "%80" yazdi.

kimlik_duvari() {
  local kod="$1" yon="$2" bas="$3" hedef="$4"

  case "$kod" in
    401|403) printf 'sunucu %s döndürdü (kimlik doğrulama isteniyor)' "$kod"; return 0 ;;
  esac

  if grep -qi '^www-authenticate:' "$bas" 2>/dev/null; then
    printf 'WWW-Authenticate başlığı var'; return 0
  fi

  # Kimlik akislarinin imzasi: BASKA bir adrese, adinda sso/login/auth gecen
  # bir yonlendirme. Apex→www ve ayni adres icindeki yol yonlendirmeleri bu
  # kaliba uymaz; kimlik disi capraz yonlendirmeler de uymaz.
  if [ -n "$yon" ]; then
    local yhost thost
    yhost="$(printf '%s' "$yon" | sed -E 's#^[a-z]+://([^/]+).*#\1#; s/^www\.//')"
    thost="$(printf '%s' "$hedef" | sed -E 's/^www\.//')"
    if [ "$yhost" != "$thost" ] && printf '%s' "$yon" | grep -qiE 'sso|login|signin|auth'; then
      printf 'farklı bir adrese kimlik yönlendirmesi (%s)' "$yhost"; return 0
    fi
  fi

  if grep -qiE '^set-cookie:.*(_vercel_sso_nonce|_vercel_jwt)' "$bas" 2>/dev/null; then
    printf 'oturum açma çerezi bırakıldı (_vercel_sso_*)'; return 0
  fi

  return 1
}
