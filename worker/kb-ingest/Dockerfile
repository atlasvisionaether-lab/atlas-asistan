# Atlas Asistan — bilgi bankası dönüştürücüsü (MinerU).
# Salonların yüklediği PDF/Word dosyalarını Markdown'a çevirip knowledge_base'e
# parça parça yazar. Vercel/Supabase Edge'de çalışamaz (Python + yerleşim/OCR
# modelleri); kendi sunucunuzda ya da herhangi bir konteyner ortamında çalışır.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    MINERU_MODEL_SOURCE=huggingface

# Word dosyaları için LibreOffice (docx → pdf), MinerU'nun görüntü işleme bağımlılıkları.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglib2.0-0 libreoffice-writer-nogui fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --upgrade pip && pip install "mineru[core]" requests

# Modeller imaj oluşturulurken indirilir: ilk belgede dakikalarca beklenmesin.
RUN mineru-models-download -s huggingface -m pipeline || true

WORKDIR /app
COPY chunker.py worker.py ./
CMD ["python", "worker.py"]
