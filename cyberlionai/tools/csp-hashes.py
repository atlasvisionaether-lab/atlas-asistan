#!/usr/bin/env python3
"""Satır içi <script> blokları için CSP sha256 hash'lerini üretir ve vercel.json + _headers
dosyalarındaki script-src listesini günceller.

Satır içi bir script'i her düzenlediğinizde çalıştırın, yoksa tarayıcı script'i engeller:

    python3 tools/csp-hashes.py          # hash'leri yazdırır ve dosyaları günceller
    python3 tools/csp-hashes.py --check  # sadece kontrol eder, değişiklik yapmaz (çıkış kodu 1 = bayat)
"""
import base64
import hashlib
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCRIPT_RE = re.compile(r'<script(?![^>]*\ssrc=)[^>]*>(.*?)</script>', re.S | re.I)


def collect_hashes():
    """Tüm HTML dosyalarındaki satır içi script gövdelerinin sha256 hash'lerini toplar."""
    hashes = []
    for path in sorted(ROOT.glob('*.html')) + sorted(ROOT.glob('*/*.html')):
        html = path.read_text(encoding='utf-8')
        for body in SCRIPT_RE.findall(html):
            digest = hashlib.sha256(body.encode('utf-8')).digest()
            value = "'sha256-" + base64.b64encode(digest).decode('ascii') + "'"
            if value not in hashes:
                hashes.append(value)
    return hashes


def build_csp(hashes):
    return '; '.join([
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "img-src 'self' data:",
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
        "script-src 'self' " + ' '.join(hashes),
        "connect-src 'self' https://ipapi.co",
        'upgrade-insecure-requests',
    ])


def main():
    check_only = '--check' in sys.argv
    csp = build_csp(collect_hashes())

    vercel_path = ROOT / 'vercel.json'
    config = json.loads(vercel_path.read_text(encoding='utf-8'))
    stale = False

    for rule in config.get('headers', []):
        for header in rule.get('headers', []):
            if header['key'] == 'Content-Security-Policy':
                if header['value'] != csp:
                    stale = True
                header['value'] = csp

    headers_path = ROOT / '_headers'
    headers_text = headers_path.read_text(encoding='utf-8')
    updated_text = re.sub(r'(?m)^(\s*Content-Security-Policy:\s*).*$',
                          lambda m: m.group(1) + csp, headers_text)
    if updated_text != headers_text:
        stale = True

    if check_only:
        print('BAYAT — csp-hashes.py çalıştırın' if stale else 'Güncel')
        return 1 if stale else 0

    vercel_path.write_text(json.dumps(config, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    headers_path.write_text(updated_text, encoding='utf-8')
    print(csp)
    return 0


if __name__ == '__main__':
    sys.exit(main())
