#!/usr/bin/env bash
# Lambda paketini üretir: aws/lambda-scanner/scanner.zip
#
# TARAMA KODU KOPYALANIR, ÇOĞALTILMAZ. Kaynak tek yerde (api/_lib/); bu betik
# onu `_lib/` altına kopyalar. `_lib/`, `_assets/` ve `scanner.zip` sürüm
# denetiminde DURMAZ (.gitignore) — depoda ikinci bir tarayıcı kopyası
# olsaydı skorlar iki yerde ayrışırdı.
#
# DİZİN DÜZENİ DEPONUN AYNISI. `pdf.js` yazı tiplerini
# `__dirname/../_assets` içinde arıyor; `_lib/` ve `_assets/` kardeş
# olmak zorunda, yoksa PDF üretimi çalışma anında patlar.
#
# Bağımlılık kurulmaz: paketin node_modules'u yok, AWS imzası node:crypto ile.
set -euo pipefail

cd "$(dirname "$0")"
LIB=../../api/_lib
ASSETS=../../api/_assets

rm -rf _lib _assets scanner.zip
mkdir -p _lib _assets

# Tarama motoru, PDF üreteci ve bağımlılıkları.
# scanner.js  → guard.js, geo.js (→ geo-table.js), mail.js, dnssec.js, owasp.js
# report-owasp.js → pdf.js, report.js
for f in scanner.js guard.js geo.js geo-table.js mail.js dnssec.js owasp.js \
         report-owasp.js report.js pdf.js; do
  cp "$LIB/$f" "_lib/$f"
done

cp "$ASSETS"/WorkSans-Regular.ttf "$ASSETS"/WorkSans-Bold.ttf \
   "$ASSETS"/LICENSE-WorkSans.txt _assets/

# Kopyanın gerçekten yüklenebildiği burada doğrulanır. Yükleme hatası
# paketlendikten sonra değil, şimdi görünmeli.
node -e "require('./_lib/scanner.js'); require('./_lib/report-owasp.js');" \
  || { echo 'HATA: kopyalanan modüller yüklenemedi' >&2; exit 1; }

zip -qr scanner.zip index.js package.json lib _lib _assets
echo "paket: $(pwd)/scanner.zip  ($(du -h scanner.zip | cut -f1))"
