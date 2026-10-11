"""Markdown'ı bilgi bankası parçalarına böler (saf, yalnızca standart kütüphane).

MinerU çıktısı başlıklar (#), paragraflar, listeler ve tablolar (Markdown ya da
HTML <table>) içerir. Asistan her mesajda en ilgili birkaç parçayı istemine
ekliyor; bu yüzden parça:
  - kendi başına anlaşılır olmalı  → hangi başlığın altında olduğu `heading`te
  - kısa olmalı                     → en çok MAX_CHARS (~600 token)
  - bir tabloyu ortadan bölmemeli   → fiyat satırı başlığından kopmasın

Görseller atılır (asistan metin okuyor; görsel bağlantısı istemde gürültü).
"""

import re

MAX_CHARS = 2400
MIN_CHARS = 300

_HEADING = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_HTML_TABLE = re.compile(r"<table\b.*?</table>", re.IGNORECASE | re.DOTALL)


def _clean(text):
    text = _IMAGE.sub("", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _blocks(body):
    """Bölümü bloklara ayırır: HTML tablo tek blok, gerisi boş satırla ayrılan paragraflar."""
    out, pos = [], 0
    for m in _HTML_TABLE.finditer(body):
        out.extend(p for p in body[pos:m.start()].split("\n\n") if p.strip())
        out.append(m.group(0))
        pos = m.end()
    out.extend(p for p in body[pos:].split("\n\n") if p.strip())
    return [b.strip() for b in out]


def _split_large(block):
    """MAX_CHARS'tan uzun tek blok: satır sınırından bölünür (tablo satırı bütün kalır)."""
    if len(block) <= MAX_CHARS:
        return [block]
    parts, cur = [], ""
    for line in block.split("\n"):
        if cur and len(cur) + len(line) + 1 > MAX_CHARS:
            parts.append(cur)
            cur = ""
        while len(line) > MAX_CHARS:  # satırın kendisi bile uzunsa kelime sınırından
            cut = line.rfind(" ", 0, MAX_CHARS)
            cut = cut if cut > MAX_CHARS // 2 else MAX_CHARS
            if cur:
                parts.append(cur)
                cur = ""
            parts.append(line[:cut].strip())
            line = line[cut:].strip()
        cur = (cur + "\n" + line) if cur else line
    if cur.strip():
        parts.append(cur)
    return parts


def sections(markdown):
    """[(başlık yolu, gövde)] — başlık yolu üst başlıklarla birlikte: 'Fiyatlar › Saç'."""
    stack, out, body = [], [], []

    def flush():
        text = _clean("\n".join(body))
        if text:
            out.append((" › ".join(t for _, t in stack), text))

    for line in markdown.splitlines():
        m = _HEADING.match(line)
        if m:
            flush()
            body = []
            level = len(m.group(1))
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, m.group(2).strip()))
        else:
            body.append(line)
    flush()
    return out


def chunk(markdown):
    """[{'index', 'heading', 'content'}] — sıra belgedeki sırayla aynı."""
    chunks = []
    for heading, body in sections(markdown):
        pieces, cur = [], ""
        for block in _blocks(body):
            for b in _split_large(block):
                if cur and len(cur) + len(b) + 2 > MAX_CHARS:
                    pieces.append(cur)
                    cur = b
                else:
                    cur = (cur + "\n\n" + b) if cur else b
        if cur:
            pieces.append(cur)
        for p in pieces:
            # Çok kısa parça aynı başlıklı bir öncekine eklenir (tek satırlık "Adres: …" gibi).
            if chunks and len(p) < MIN_CHARS and chunks[-1]["heading"] == heading \
                    and len(chunks[-1]["content"]) + len(p) + 2 <= MAX_CHARS:
                chunks[-1]["content"] += "\n\n" + p
            else:
                chunks.append({"heading": heading, "content": p})
    for i, c in enumerate(chunks):
        c["index"] = i
    return chunks
