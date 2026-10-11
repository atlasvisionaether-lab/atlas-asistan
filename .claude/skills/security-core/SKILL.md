---
name: security-core
description: SSL ve security headers tarama çekirdeği. /scan endpoint'i için kullanılır.
allowed-tools: Read, Write, Edit, Bash
---
# Security Core
- Input: domain (string)
- Output: { ssl: {...}, headers: { HSTS, CSP, X-Frame... }, score: 0-100 }
- Kaynak: web/lib/scanner.ts
- Koru: /api/verify-dns, CSP hash mantığını bozma
- Hız komutu: bun run scanner.test.ts
