"""worker.py sınaması — ağ ve MinerU yok (sahte oturum + sahte dönüştürücü).
Çalıştırma: `python3 test_worker.py`"""

import subprocess
import worker

passed, failed = 0, []


def check(name, cond):
    global passed
    if cond:
        passed += 1
    else:
        failed.append(name)


class Resp:
    def __init__(self, status=200, data=None, body=b""):
        self.status_code, self._data, self._body = status, data, body

    def json(self):
        return self._data

    def iter_content(self, n):
        yield self._body


class Session:
    """PostgREST/Storage çağrılarını kaydeden sahte oturum."""

    def __init__(self, pending=None, patch_wins=True, download_status=200):
        self.headers, self.calls = {}, []
        self.pending, self.patch_wins, self.download_status = pending or [], patch_wins, download_status

    def get(self, url, params=None, stream=False):
        self.calls.append(("GET", url, params))
        if "/storage/v1/object/" in url:
            return Resp(self.download_status, body=b"%PDF-1.4 sahte")
        return Resp(200, self.pending)

    def patch(self, url, params=None, headers=None, json=None):
        self.calls.append(("PATCH", url, params, json))
        if json and json.get("status") == "processing":
            return Resp(200, [dict(self.pending[0], status="processing")] if self.patch_wins else [])
        return Resp(204)

    def delete(self, url, params=None):
        self.calls.append(("DELETE", url, params))
        return Resp(204)

    def post(self, url, headers=None, json=None):
        self.calls.append(("POST", url, json))
        return Resp(201)


DOC = {"id": "d1", "organization_id": "o1", "storage_path": "o1/abc-fiyat.pdf", "status": "pending"}


def db_with(**kw):
    return worker.Db("https://x.supabase.co/", "servis-anahtari", session=Session(**kw))


# --- talep ---
db = db_with(pending=[DOC])
got = db.claim()
check("talep: belge alındı", got and got["id"] == "d1" and got["status"] == "processing")
patch = [c for c in db.s.calls if c[0] == "PATCH"][0]
check("talep: yalnızca hâlâ pending ise", patch[2] == {"id": "eq.d1", "status": "eq.pending"})
check("servis anahtarı başlıkta", db.s.headers["Authorization"] == "Bearer servis-anahtari")
check("talep: kuyruk boş", db_with(pending=[]).claim() is None)
check("talep: başka işçi kaptı", db_with(pending=[DOC], patch_wins=False).claim() is None)

# --- başarılı işleme ---
db = db_with(pending=[DOC])
chunks = [{"index": 0, "heading": "Fiyatlar", "content": "Kesim 450 TL"},
          {"index": 1, "heading": "", "content": "Adres"}]
status, n = worker.process(db, DOC, converter=lambda path: chunks)
check("işleme: review", status == "review" and n == 2)
dl = [c for c in db.s.calls if c[0] == "GET" and "/storage/" in c[1]][0]
check("indirme: özel kova + yol", dl[1].endswith("/storage/v1/object/kb-uploads/o1/abc-fiyat.pdf"))
delete = [c for c in db.s.calls if c[0] == "DELETE"][0]
check("eski parçalar önce silinir", delete[2] == {"document_id": "eq.d1"})
post = [c for c in db.s.calls if c[0] == "POST"][0]
check("parçalar belge ve kuruma bağlı", all(r["document_id"] == "d1" and r["organization_id"] == "o1" for r in post[2]))
check("boş başlık null yazılır", post[2][1]["heading"] is None)
check("sıra korunur", [r["chunk_index"] for r in post[2]] == [0, 1])
fin = [c for c in db.s.calls if c[0] == "PATCH"][-1]
check("bitiş: review + parça sayısı", fin[3]["status"] == "review" and fin[3]["chunk_count"] == 2)
check("silme yazmadan önce", db.s.calls.index(delete) < db.s.calls.index(post))

# --- hatalar belgeye yazılır, istisna dışarı kaçmaz ---
def boom(path):
    raise subprocess.CalledProcessError(1, ["mineru"], stderr=b"Traceback ...\nRuntimeError: model not found")

db = db_with(pending=[DOC])
status, n = worker.process(db, DOC, converter=boom)
fin = [c for c in db.s.calls if c[0] == "PATCH"][-1]
check("hata: failed", status == "failed" and fin[3]["status"] == "failed")
check("hata: kısa sebep", fin[3]["error"].startswith("convert_failed:") and len(fin[3]["error"]) <= worker.MAX_ERROR)
check("hata: parça yazılmadı", not [c for c in db.s.calls if c[0] == "POST"])

db = db_with(pending=[DOC])
status, _ = worker.process(db, DOC, converter=lambda p: [])
fin = [c for c in db.s.calls if c[0] == "PATCH"][-1]
check("metin çıkmadı → failed", status == "failed" and fin[3]["error"] == "no_text_extracted")

db = db_with(pending=[DOC], download_status=404)
status, _ = worker.process(db, DOC, converter=lambda p: chunks)
fin = [c for c in db.s.calls if c[0] == "PATCH"][-1]
check("indirilemedi → failed", status == "failed" and fin[3]["error"] == "db_error_404")

check("zaman aşımı kodu", worker.error_code(subprocess.TimeoutExpired("mineru", 900)) == "timeout")
try:
    worker.to_pdf("/tmp/x.exe", "/tmp")
    check("desteklenmeyen tür reddedilir", False)
except ValueError as e:
    check("desteklenmeyen tür reddedilir", str(e) == "unsupported_type")

if failed:
    print("worker: %d KALDI, %d geçti" % (len(failed), passed))
    for f in failed:
        print("  ✗", f)
    raise SystemExit(1)
print("worker: %d / %d geçti" % (passed, passed))
