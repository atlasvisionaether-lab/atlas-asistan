#!/usr/bin/env bash
# Jarvis - model secme ve degistirme araci
# Kullanim:
#   bash switch-model.sh            -> donanimi olcer, listeden secmenizi ister
#   bash switch-model.sh qwen3:8b   -> dogrudan o modele gecer
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$DIR/.env"

info() { echo -e "\033[1;36m[JARVIS]\033[0m $*"; }
warn() { echo -e "\033[1;33m[UYARI]\033[0m  $*"; }
err()  { echo -e "\033[1;31m[HATA]\033[0m   $*" >&2; }

# ------------------------------------------------------------------ donanim
RAM_GB=$(awk '/MemTotal/ {printf "%d", $2/1024/1024}' /proc/meminfo)
VRAM_GB=0
GPU_NAME=""
if command -v nvidia-smi >/dev/null 2>&1; then
  VRAM_MB=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ') || VRAM_MB=""
  GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1) || GPU_NAME=""
  [ -n "${VRAM_MB:-}" ] && VRAM_GB=$(( VRAM_MB / 1024 ))
fi

echo
info "Donanim: ${RAM_GB} GB RAM${GPU_NAME:+, $GPU_NAME (${VRAM_GB} GB VRAM)}"
[ "$VRAM_GB" -eq 0 ] && warn "Nvidia ekran karti bulunamadi; modeller islemcide calisacak (daha yavas)."

# Modelin tamami ekran kartina sigarsa cok daha hizli calisir.
# Yaklasik disk/bellek ihtiyaci (4 bit): 8B ~5 GB, 12B ~8 GB, 14B ~9 GB, 30B ~18 GB
if   [ "$VRAM_GB" -ge 20 ] || { [ "$VRAM_GB" -eq 0 ] && [ "$RAM_GB" -ge 48 ]; }; then ONERI="qwen3:30b-a3b"
elif [ "$VRAM_GB" -ge 12 ] || { [ "$VRAM_GB" -eq 0 ] && [ "$RAM_GB" -ge 32 ]; }; then ONERI="qwen3:14b"
elif [ "$VRAM_GB" -ge 8 ]  || { [ "$VRAM_GB" -eq 0 ] && [ "$RAM_GB" -ge 16 ]; }; then ONERI="qwen3:8b"
elif [ "$VRAM_GB" -ge 6 ]  || [ "$RAM_GB" -ge 8 ];                                then ONERI="qwen2.5:7b"
else                                                                                   ONERI="qwen2.5:3b"
fi

MODELS=(
  "qwen3:8b|~5 GB|Guclu muhakeme, iyi Turkce. 8 GB VRAM icin ideal."
  "qwen3:14b|~9 GB|Daha isabetli cevaplar. 12 GB+ VRAM ister."
  "gemma3:12b|~8 GB|Google modeli, cok dilli yani guclu."
  "qwen2.5:7b|~5 GB|Simdiki model. Hizli ama muhakemesi zayif."
  "llama3.1:8b|~5 GB|Meta modeli, Turkcesi qwen'den geride."
  "qwen3:30b-a3b|~18 GB|Cok guclu, sadece 20 GB+ VRAM ya da 48 GB+ RAM ile."
)

# ------------------------------------------------------------------- secim
if [ $# -ge 1 ]; then
  MODEL="$1"
else
  echo
  echo "  Kurulabilecek modeller:"
  echo
  i=1
  for row in "${MODELS[@]}"; do
    IFS='|' read -r name size desc <<< "$row"
    mark="  "
    [ "$name" = "$ONERI" ] && mark="->"
    printf "  %s %d) %-14s %-7s %s\n" "$mark" "$i" "$name" "$size" "$desc"
    i=$((i + 1))
  done
  echo
  info "Donaniminiz icin onerilen: $ONERI  (-> ile isaretli)"
  echo
  read -r -p "  Numara secin (bos birakirsaniz $ONERI kurulur): " secim
  if [ -z "$secim" ]; then
    MODEL="$ONERI"
  else
    row="${MODELS[$((secim - 1))]:-}"
    [ -z "$row" ] && { err "Gecersiz secim."; exit 1; }
    MODEL="${row%%|*}"
  fi
fi

# ------------------------------------------------------------------ indirme
if ! curl -fsS http://localhost:11434/api/tags >/dev/null 2>&1; then
  err "Ollama calismiyor. Once: sudo systemctl start ollama"
  exit 1
fi

info "$MODEL indiriliyor (bir kez, boyutuna gore birkac dakika)..."
if ! ollama pull "$MODEL"; then
  err "$MODEL indirilemedi. Model adini https://ollama.com/library adresinden dogrulayin."
  exit 1
fi

# ------------------------------------------------------------- .env guncelle
if [ ! -f "$ENV_FILE" ]; then
  cp "$DIR/.env.example" "$ENV_FILE"
fi
if grep -q '^JARVIS_MODEL=' "$ENV_FILE"; then
  sed -i "s|^JARVIS_MODEL=.*|JARVIS_MODEL=$MODEL|" "$ENV_FILE"
else
  echo "JARVIS_MODEL=$MODEL" >> "$ENV_FILE"
fi

echo
info "Aktif model: $MODEL"
info "Jarvis'i yeniden baslatin (pencereyi kapatip tekrar acin)."
echo
echo "  Eski modeli silmek isterseniz:  ollama rm qwen2.5:7b"
