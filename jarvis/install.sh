#!/usr/bin/env bash
# Jarvis - Ubuntu kurulum betigi
# Kullanim: bash install.sh
set -euo pipefail

JARVIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$JARVIS_DIR/.venv"
VOICE_DIR="$JARVIS_DIR/voices"

info()  { echo -e "\033[1;36m[JARVIS]\033[0m $*"; }
warn()  { echo -e "\033[1;33m[UYARI]\033[0m  $*"; }
err()   { echo -e "\033[1;31m[HATA]\033[0m   $*" >&2; }

if [ "$(id -u)" -eq 0 ]; then
  warn "Betigi root olarak calistiriyorsunuz. Normal kullanici ile calistirmaniz onerilir."
fi

# ---------------------------------------------------------------- 1. sistem paketleri
info "1/6 - Sistem paketleri kuruluyor (sudo sifresi istenebilir)..."
sudo apt-get update -y
sudo apt-get install -y \
  curl git ca-certificates \
  python3 python3-venv python3-pip python3-dev python3-tk \
  build-essential \
  ffmpeg \
  portaudio19-dev libasound2-dev \
  espeak-ng \
  libnotify-bin \
  alsa-utils

# ---------------------------------------------------------------- 2. ollama
info "2/6 - Ollama kontrol ediliyor..."
if command -v ollama >/dev/null 2>&1; then
  info "Ollama zaten kurulu: $(ollama --version 2>/dev/null | head -1)"
else
  info "Ollama kuruluyor..."
  curl -fsSL https://ollama.com/install.sh | sh
fi

# servisi ayaga kaldir
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q '^ollama.service'; then
  sudo systemctl enable --now ollama || warn "ollama servisi baslatilamadi, elle 'ollama serve' calistirin."
else
  warn "systemd ollama servisi bulunamadi. Gerekirse ayri bir terminalde 'ollama serve' calistirin."
fi

# API hazir mi bekle
info "Ollama API bekleniyor (http://localhost:11434)..."
for i in $(seq 1 30); do
  if curl -fsS http://localhost:11434/api/tags >/dev/null 2>&1; then
    info "Ollama API hazir."
    break
  fi
  sleep 1
  [ "$i" -eq 30 ] && warn "Ollama API'ye ulasilamadi. Model indirme adimi atlanabilir."
done

# ---------------------------------------------------------------- 3. model secimi
RAM_GB=$(awk '/MemTotal/ {printf "%d", $2/1024/1024}' /proc/meminfo)
if [ "${JARVIS_MODEL:-}" != "" ]; then
  MODEL="$JARVIS_MODEL"
elif [ "$RAM_GB" -ge 16 ]; then
  MODEL="qwen2.5:7b"
elif [ "$RAM_GB" -ge 8 ]; then
  MODEL="qwen2.5:3b"
else
  MODEL="qwen2.5:1.5b"
fi
info "3/6 - Sistem RAM: ${RAM_GB}GB -> model: $MODEL (degistirmek icin: JARVIS_MODEL=llama3.1:8b bash install.sh)"
if curl -fsS http://localhost:11434/api/tags >/dev/null 2>&1; then
  ollama pull "$MODEL" || warn "Model indirilemedi, sonra 'ollama pull $MODEL' calistirin."
else
  warn "Ollama calismiyor; model indirilmedi."
fi

# ---------------------------------------------------------------- 4. python ortami
info "4/6 - Python sanal ortami hazirlaniyor..."
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --upgrade pip wheel setuptools
"$VENV_DIR/bin/pip" install -r "$JARVIS_DIR/requirements.txt"

# ---------------------------------------------------------------- 5. turkce ses (piper)
info "5/6 - Turkce TTS sesi indiriliyor (piper)..."
mkdir -p "$VOICE_DIR"
PIPER_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/tr/tr_TR/dfki/medium"
for f in tr_TR-dfki-medium.onnx tr_TR-dfki-medium.onnx.json; do
  if [ -s "$VOICE_DIR/$f" ]; then
    info "$f zaten mevcut."
  else
    curl -fL --retry 3 -o "$VOICE_DIR/$f" "$PIPER_BASE/$f?download=true" \
      || warn "$f indirilemedi. Jarvis espeak-ng sesine dusecek."
  fi
done

# ---------------------------------------------------------------- 6. yapilandirma + kisayol
info "6/6 - Yapilandirma yaziliyor..."
if [ ! -f "$JARVIS_DIR/.env" ]; then
  sed "s|^JARVIS_MODEL=.*|JARVIS_MODEL=$MODEL|" "$JARVIS_DIR/.env.example" > "$JARVIS_DIR/.env"
  info ".env olusturuldu."
else
  # Mevcut .env korunur; yalnizca yeni eklenen ayarlar sonuna yazilir.
  eklenen=0
  while IFS= read -r satir; do
    case "$satir" in
      ''|'#'*) continue ;;
    esac
    anahtar="${satir%%=*}"
    if ! grep -q "^${anahtar}=" "$JARVIS_DIR/.env"; then
      [ "$eklenen" -eq 0 ] && printf '\n# --- yeni ayarlar (guncelleme ile eklendi) ---\n' >> "$JARVIS_DIR/.env"
      echo "$satir" >> "$JARVIS_DIR/.env"
      eklenen=$((eklenen + 1))
    fi
  done < "$JARVIS_DIR/.env.example"
  if [ "$eklenen" -gt 0 ]; then
    info ".env korundu, $eklenen yeni ayar eklendi."
  else
    info ".env guncel, dokunulmadi."
  fi
fi

cat > "$JARVIS_DIR/jarvis" <<RUNNER
#!/usr/bin/env bash
exec "$VENV_DIR/bin/python" "$JARVIS_DIR/jarvis.py" "\$@"
RUNNER
chmod +x "$JARVIS_DIR/jarvis"

cat > "$JARVIS_DIR/jarvis-gui" <<RUNNER
#!/usr/bin/env bash
cd "$JARVIS_DIR" || exit 1
exec "$VENV_DIR/bin/python" "$JARVIS_DIR/jarvis_gui.py" "\$@"
RUNNER
chmod +x "$JARVIS_DIR/jarvis-gui"

mkdir -p "$HOME/.local/bin"
ln -sf "$JARVIS_DIR/jarvis" "$HOME/.local/bin/jarvis"
ln -sf "$JARVIS_DIR/jarvis-gui" "$HOME/.local/bin/jarvis-gui"
ln -sf "$JARVIS_DIR/switch-model.sh" "$HOME/.local/bin/jarvis-model"
info "Kisayollar: ~/.local/bin/jarvis, jarvis-gui, jarvis-model"

# --- uygulama menusu girdisi -------------------------------------------------
if "$VENV_DIR/bin/python" -c "import tkinter" >/dev/null 2>&1; then
  APPS_DIR="$HOME/.local/share/applications"
  mkdir -p "$APPS_DIR"
  cat > "$APPS_DIR/jarvis.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Atlas
GenericName=Yerel Yapay Zeka Asistani
Comment=Ollama ile calisan Turkce sesli asistan
Exec=$JARVIS_DIR/jarvis-gui
Icon=$JARVIS_DIR/icon.svg
Terminal=false
Categories=Utility;Office;
StartupNotify=true
DESKTOP
  chmod +x "$APPS_DIR/jarvis.desktop"
  update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
  info "Uygulama menusune eklendi (Etkinlikler > Atlas)."
else
  warn "tkinter bulunamadi; pencere uygulamasi devre disi."
  warn "Kurmak icin: sudo apt install -y python3-tk  (sonra bu betigi tekrar calistirin)"
fi

echo
info "Kurulum tamamlandi!"
echo
echo "  Pencere    : $JARVIS_DIR/jarvis-gui   (ya da uygulama menusunden 'Jarvis')"
echo "  Yazili mod : $JARVIS_DIR/jarvis"
echo "  Sesli mod  : $JARVIS_DIR/jarvis --voice"
echo "  Tek soru   : $JARVIS_DIR/jarvis -p \"Merhaba, kendini tanit\""
echo "  Model degis: bash $JARVIS_DIR/switch-model.sh"
echo
echo "  ('jarvis' komutu calismazsa: export PATH=\"\$HOME/.local/bin:\$PATH\")"
