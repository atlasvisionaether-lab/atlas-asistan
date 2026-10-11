"""Atlas Asistan — bilgi bankası dönüştürücüsü.

Akış (kb_documents.status):
  pending ──(bu işçi talep eder)──► processing ──► review   (panelde salon onaylar → approved)
                                              └──► failed   (error alanında kısa sebep)

Her döngüde EN ESKİ bir 'pending' belge alınır. Talep atomik: PATCH yalnızca
satır hâlâ 'pending' ise uygulanır; iki işçi aynı belgeyi alamaz.

Belge Supabase Storage'daki ÖZEL 'kb-uploads' kovasından servis anahtarıyla
indirilir, MinerU ile Markdown'a çevrilir, chunker.py ile parçalanır ve
knowledge_base'e yazılır. Yeniden işlemede önce belgenin eski parçaları silinir.
Asistan yalnızca 'approved' belgelerin parçalarını kullanır (kb_search).

Ortam değişkenleri:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   zorunlu (servis anahtarı LOGLANMAZ)
  POLL_SECONDS=15, MINERU_BACKEND=pipeline, MAX_PAGES=60, MINERU_TIMEOUT=900

Yerel deneme (veritabanı yok):  python worker.py --file fiyat-listesi.pdf
"""

import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

import chunker

BUCKET = "kb-uploads"
MAX_ERROR = 300


def env(name, default=None):
    v = os.environ.get(name, default)
    if v is None:
        raise SystemExit("eksik ortam değişkeni: " + name)
    return v


# ------------------------------------------------------------------ dönüştürme

def to_pdf(path, workdir):
    """Word belgesini LibreOffice ile PDF'e çevirir; PDF ise olduğu gibi döner."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pdf":
        return path
    if ext not in (".docx", ".doc", ".odt"):
        raise ValueError("unsupported_type")
    subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", workdir, path],
                   check=True, capture_output=True, timeout=180)
    out = os.path.join(workdir, os.path.splitext(os.path.basename(path))[0] + ".pdf")
    if not os.path.exists(out):
        raise ValueError("docx_conversion_failed")
    return out


def mineru_markdown(pdf, workdir):
    """MinerU CLI ile Markdown üretir ve metni döner."""
    out = os.path.join(workdir, "mineru-out")
    cmd = ["mineru", "-p", pdf, "-o", out, "-b", os.environ.get("MINERU_BACKEND", "pipeline")]
    max_pages = int(os.environ.get("MAX_PAGES", "60"))
    if max_pages > 0:
        cmd += ["-e", str(max_pages - 1)]  # son sayfa dizini (0 tabanlı): uzun belge işçiyi kilitlemesin
    subprocess.run(cmd, check=True, capture_output=True, timeout=int(os.environ.get("MINERU_TIMEOUT", "900")))
    found = sorted(glob.glob(os.path.join(out, "**", "*.md"), recursive=True))
    if not found:
        raise ValueError("no_markdown_output")
    with open(found[0], encoding="utf-8") as f:
        return f.read()


def convert(path):
    """Dosya yolu → parça listesi (chunker biçiminde)."""
    work = tempfile.mkdtemp(prefix="kb-")
    try:
        md = mineru_markdown(to_pdf(path, work), work)
        return chunker.chunk(md)
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ------------------------------------------------------------------ veritabanı

class Db:
    """PostgREST + Storage, servis rolüyle. `session` sınamada saplanır."""

    def __init__(self, url, key, session=None):
        import requests  # yalnızca gerçek çalışmada gerekir
        self.url = url.rstrip("/")
        self.s = session or requests.Session()
        self.s.headers.update({"apikey": key, "Authorization": "Bearer " + key})

    def _ok(self, r):
        if r.status_code >= 300:
            raise RuntimeError("db_error_%d" % r.status_code)
        return r

    def claim(self):
        """En eski 'pending' belgeyi 'processing'e çeker; yoksa ya da başkası aldıysa None."""
        r = self._ok(self.s.get(self.url + "/rest/v1/kb_documents",
                                params={"status": "eq.pending", "select": "id", "order": "created_at.asc", "limit": "1"}))
        rows = r.json()
        if not rows:
            return None
        r = self._ok(self.s.patch(self.url + "/rest/v1/kb_documents",
                                  params={"id": "eq." + rows[0]["id"], "status": "eq.pending"},
                                  headers={"Prefer": "return=representation"},
                                  json={"status": "processing", "error": None}))
        got = r.json()
        return got[0] if got else None

    def download(self, storage_path, dest):
        r = self._ok(self.s.get(self.url + "/storage/v1/object/" + BUCKET + "/" + storage_path, stream=True))
        with open(dest, "wb") as f:
            for part in r.iter_content(64 * 1024):
                f.write(part)

    def replace_chunks(self, doc, chunks):
        self._ok(self.s.delete(self.url + "/rest/v1/knowledge_base", params={"document_id": "eq." + doc["id"]}))
        if not chunks:
            return
        rows = [{"organization_id": doc["organization_id"], "document_id": doc["id"],
                 "chunk_index": c["index"], "heading": c["heading"] or None, "content": c["content"]}
                for c in chunks]
        self._ok(self.s.post(self.url + "/rest/v1/knowledge_base", headers={"Prefer": "return=minimal"}, json=rows))

    def finish(self, doc_id, patch):
        self._ok(self.s.patch(self.url + "/rest/v1/kb_documents", params={"id": "eq." + doc_id},
                              headers={"Prefer": "return=minimal"}, json=patch))


def error_code(exc):
    """Kullanıcıya gösterilecek kısa, kişisel veri içermeyen sebep."""
    if isinstance(exc, subprocess.TimeoutExpired):
        return "timeout"
    if isinstance(exc, subprocess.CalledProcessError):
        tail = (exc.stderr or b"")[-200:].decode("utf-8", "replace").strip().replace("\n", " ")
        return ("convert_failed: " + tail)[:MAX_ERROR]
    return str(exc)[:MAX_ERROR] or exc.__class__.__name__


def process(db, doc, converter=convert):
    """Tek belge: indir → dönüştür → parçala → yaz → durum. Hata 'failed' olur, döngü sürer."""
    work = tempfile.mkdtemp(prefix="kb-doc-")
    try:
        local = os.path.join(work, os.path.basename(doc["storage_path"]))
        db.download(doc["storage_path"], local)
        chunks = converter(local)
        if not chunks:
            raise ValueError("no_text_extracted")
        db.replace_chunks(doc, chunks)
        db.finish(doc["id"], {"status": "review", "chunk_count": len(chunks), "error": None,
                              "processed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
        return "review", len(chunks)
    except Exception as exc:  # noqa: BLE001 — her hata belgeye yazılır, işçi durmaz
        db.finish(doc["id"], {"status": "failed", "error": error_code(exc),
                              "processed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
        return "failed", 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


def loop():
    db = Db(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"))
    poll = int(os.environ.get("POLL_SECONDS", "15"))
    print("kb-ingest: başladı (poll=%ss)" % poll, flush=True)
    while True:
        try:
            doc = db.claim()
        except Exception as exc:  # noqa: BLE001
            print("kb-ingest: talep hatası:", error_code(exc), flush=True)
            time.sleep(poll)
            continue
        if not doc:
            time.sleep(poll)
            continue
        status, n = process(db, doc)
        print("kb-ingest: %s → %s (%d parça)" % (doc["id"], status, n), flush=True)


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--file":
        print(json.dumps(convert(sys.argv[2]), ensure_ascii=False, indent=2))
    else:
        loop()
