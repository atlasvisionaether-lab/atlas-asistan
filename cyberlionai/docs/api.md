# Cyber Lion AI — API Sözleşmesi

Ön yüz bu sözleşmeye göre yazılmıştır. `index.html` içindeki `API` nesnesi tek
erişim noktasıdır; backend hazır olduğunda `CONFIG.useMockApi = false` ve
`CONFIG.apiBaseUrl` ayarlanır, arayüz kodunda başka değişiklik gerekmez.

Ortak kurallar:

- İstek ve yanıt gövdeleri `application/json`.
- `#csrfToken` alanı doluysa `X-CSRF-Token` başlığı eklenir.
- Oturum açıksa `Authorization: Bearer <token>` gönderilir.
- Hata yanıtları: `{ "error": { "code": "...", "message": "..." } }` ve uygun HTTP kodu.

---

## Tarama

### `POST /api/scan`
```json
{ "url": "ornek.com", "type": "quick | full", "mode": "autonomous | semi_autonomous | managed | null" }
```
`mode`, müşterinin seçtiği düzeltme yöntemidir; seçilmemişse `null` gider ve
kullanıcının kayıtlı tercihi (`users.preferred_remediation_mode`) uygulanır.

Yanıt: `{ "scanId": "uuid", "url": "...", "type": "quick", "mode": "...", "status": "queued" }`

### `GET /api/scan/{scanId}`
```json
{ "status": "completed", "score": 62,
  "findings": [ { "id": "uuid", "index": 0, "severity": "high", "passed": false } ] }
```
`severity`: `critical | high | medium | low`. Ön yüz bulguyu `index` ile
yerelleştirilmiş metne eşler; backend serbest metin döndürecekse `title` alanı
ekleyip `addFinding()` fonksiyonu onu kullanacak şekilde güncellenir.

---

## Düzeltme (Remediation)

### `POST /api/remediate`
```json
{
  "scanId": "uuid",
  "vulnerabilityIds": ["uuid1", "uuid2"],
  "mode": "autonomous | semi_autonomous | managed",
  "integration": {
    "type": "github | gitlab | cloudflare | aws | manual",
    "config": { }
  }
}
```

Mod başına beklenen davranış:

| Mod | Yanıt `status` | Sonraki adım |
|---|---|---|
| `autonomous` | `running` | Düzeltmeler uygulanır, doğrulanır; hata hâlinde geri alınır |
| `semi_autonomous` | `awaiting_approval` | `approvals` kaydı açılır, müşteriye bildirim gider |
| `managed` | `running` | `managed_tickets` kaydı açılır, uzman ekibe atanır |

**Zorunlu:** her adım (`generate_fix`, `apply`, `verify`, `rollback`, `escalate`)
`remediation_audit_log` tablosuna yazılır. Otonom modda bu iz olmadan düzeltme
uygulanmamalıdır.

### `GET /api/remediation/{scanId}/status`
```json
{ "scanId": "uuid", "mode": "autonomous", "stage": "applying", "progress": 60,
  "fixesApplied": 3, "fixesFailed": 0 }
```

---

## Onay Akışı (yalnızca `semi_autonomous`)

### `GET /api/approvals/{scanId}`
```json
{ "scanId": "uuid", "status": "pending", "expiresAt": "2026-09-10T12:00:00Z",
  "proposals": [
    { "vulnerabilityId": "uuid", "title": "CSP başlığı tanımlı değil",
      "severity": "high", "proposedFix": { "type": "header", "diff": "..." },
      "estimatedImpact": "low", "riskReduction": 18 }
  ] }
```

### `POST /api/approvals/{scanId}/respond`
```json
{ "decision": "approve_selected | auto_apply_all | reject_all",
  "selectedIds": ["uuid1"] }
```
`selectedIds` yalnızca `approve_selected` için gereklidir. Onaylar
`expires_at` (varsayılan 24 saat) sonrası `expired` olur ve düzeltme uygulanmaz.

---

## Yönetilen Hizmet

### `GET /api/managed/{scanId}/ticket`
```json
{ "scanId": "uuid", "ticketNumber": "CLA-1042", "status": "in_progress",
  "assignedTeam": "security_experts", "priority": "high",
  "createdAt": "...", "expertComments": ["..."] }
```

---

## Kullanıcı Tercihi

### `POST /api/user/preferences`
```json
{ "preferredMode": "autonomous | semi_autonomous | managed" }
```
Yanıt: `{ "ok": true, "preferredMode": "..." }`

Oturum yoksa tercih yalnızca tarayıcıda (`localStorage.preferredRemediationMode`)
tutulur; ön yüz bu durumda da çalışır.

---

## Kimlik Doğrulama

### `POST /api/auth/register` — `{ "email": "...", "password": "..." }`
### `POST /api/auth/login` — `{ "email": "...", "password": "..." }`

Şifre en az 8 karakter olmalıdır (ön yüzde de doğrulanır). Yanıtta `token`
döndürülürse `localStorage.authToken` içine yazılır.

---

## Veritabanı

Şema `db/migrations/001_remediation.sql` dosyasındadır:
`users`, `scans`, `vulnerabilities`, `approvals`, `managed_tickets`,
`remediation_runs`, `remediation_audit_log`.

Dikkat edilecek kısıtlar:

- `approvals_one_pending_per_scan` — bir tarama için aynı anda tek bekleyen onay.
- `approvals_decision_consistency` — karar verilmiş onayda `decision` ve
  `responded_at` birlikte dolu olmalı.
- `managed_tickets_resolution` — `resolved`/`closed` ticket'ta `resolved_at` zorunlu.

---

## Canlı Destek Asistanı

Asistan üç kademeli çalışır:

1. **Yerel bilgi tabanı** — tarayıcıda, anahtar kelime eşleşmesiyle, ağ isteği
   olmadan. Bugün çalışan kademe budur.
2. **Sunucu analizi** — `POST /api/support`. `CONFIG.useMockApi = false`
   olduğunda çağrılır.
3. **Uzman yönlendirmesi** — eşleşme yoksa veya aciliyet puanı ≥ 6 ise;
   kullanıcıya doğrudan ekibe yazma bağlantısı verilir.

### `POST /api/support`
```json
{ "sessionId": "sess-abc123",
  "message": "CSP nasıl eklenir?",
  "context": { "topic": "csp", "urgency": 0 } }
```
Yanıt:
```json
{ "sessionId": "sess-abc123", "layer": "server", "answer": "…",
  "confidence": 0.93, "codeExamples": ["…"], "suggestions": ["hsts", "xframe"] }
```
`confidence` 0.85 altındaysa ön yüz yerel yanıtta kalır; `answer` `null` ise
kademe atlanır.

**Aciliyet puanı:** kritik kelime (hack, sızıntı, fidye, site düştü…) +4,
yüksek kelime (acil, kritik, çalışmıyor…) +2, üst sınır 10. 6 ve üzeri
doğrudan uzman kademesine gider ve `support_escalations` kaydı açılır.

### Veritabanı

`db/migrations/002_support.sql`: `support_sessions`, `support_messages`,
`support_escalations`, `support_kb_entries`.

`support_kb_entries`, yanıtları yeniden dağıtım yapmadan güncellemek ve hangi
konunun ne sıklıkta sorulduğunu (`hit_count`) ölçmek içindir. Ön yüz kendi
kopyasını gömülü taşıdığı için sunucu erişilemese de asistan çalışmayı sürdürür.

---

## Gerçek tarama motoru (yayında)

`POST /api/scan` artık **gerçek bir sunucusuz fonksiyondur** (`api/scan.js`).
Hedefe sunucudan istek atar, güvenlik başlıklarını ve TLS yapılandırmasını
ölçer, sonucu tek yanıtta döndürür.

### İstek
```json
{ "url": "ornek.com" }
```

### Yanıt
```json
{
  "url": "https://ornek.com/",
  "host": "ornek.com",
  "httpStatus": 200,
  "redirects": 1,
  "score": 64,
  "warnings": [],
  "checks": [
    { "id": "csp", "severity": "critical", "status": "fail", "detail": null, "note": null }
  ],
  "summary": { "total": 13, "passed": 7, "failed": 5, "skipped": 1, "critical": 1, "high": 2 },
  "durationMs": 812,
  "scannedAt": "2026-09-09T11:00:00.000Z",
  "isDemo": false
}
```

`status`: `pass` | `fail` | `skipped`. **`skipped` skora girmez** — ölçülemeyen
bir maddeyi başarısız saymak yanlış rapor üretmek olur.

### Kontroller (13)

| id | Önem | Ne ölçülüyor |
|---|---|---|
| `https` | critical | Nihai adres HTTPS mi |
| `csp` | critical | CSP var mı; `script-src` içinde nonce/hash olmadan `unsafe-inline` varsa başarısız |
| `hsts` | high | HSTS var mı ve `max-age` ≥ 180 gün mü |
| `cookies` | high | Set-Cookie başlıklarında Secure + HttpOnly + SameSite |
| `mixed_content` | high | HTTPS sayfada `http://` ile yüklenen kaynaklar (HTML ayrıştırılır) |
| `tls_protocol` | high | Görüşülen protokol TLS 1.2/1.3 mü |
| `tls_cert` | high | Sertifika güvenilir mi, kalan gün sayısı |
| `tls_legacy` | high | Sunucu TLS 1.0/1.1 kabul ediyor mu (ayrı el sıkışma denemesi) |
| `xframe` | medium | X-Frame-Options veya CSP `frame-ancestors` |
| `nosniff` | medium | X-Content-Type-Options: nosniff |
| `referrer` | low | Referrer-Policy |
| `permissions` | low | Permissions-Policy |
| `disclosure` | low | Server / X-Powered-By içinde sürüm numarası |

Ağırlıklar: critical 10, high 7, medium 4, low 2.
Skor = `(1 − kaybedilen ağırlık / ölçülen toplam ağırlık) × 100`.

### Hata kodları

| Kod | HTTP | Anlamı |
|---|---|---|
| `empty`, `invalid_url`, `too_long`, `bad_protocol`, `credentials_not_allowed`, `blocked_port`, `dns_failed` | 400 | Girdi hatalı |
| `blocked_target` | 403 | Özel ağ / yerel adres — SSRF koruması |
| `unreachable`, `bad_redirect`, `too_many_redirects` | 502 | Hedefe ulaşılamadı |
| `timeout` | 504 | Hedef zamanında yanıt vermedi |
| `rate_limited` | 429 | Hız sınırı (IP başına 10 dakikada 12 tarama) |

### Güvenlik

Bu uç, kullanıcının verdiği adrese **bizim sunucumuzdan** istek attığı için
SSRF açısından hassastır. `api/_lib/guard.js` şunları reddeder:

- Döngü (127.0.0.0/8, ::1), özel bloklar (10/8, 172.16/12, 192.168/16, fc00::/7)
- Bağlantı yerel **169.254.0.0/16** — bulut meta veri servisi buradadır
- CGNAT (100.64/10), çoklu yayın, ayrılmış bloklar
- `localhost` gibi noktasız adlar, adres içinde kullanıcı adı/şifre
- 80/443/8080/8443 dışındaki portlar

Doğrulama **her yönlendirme adımında yeniden** yapılır: ilk adres güvenli olsa
bile sonraki adım özel bir IP'ye gidemez. Yanıt gövdesi 512 KB'de kesilir,
istekler 9 saniyede zaman aşımına uğrar, en fazla 4 yönlendirme izlenir.

---

## Sınırlar (kalıcı, sunucu tarafında)

| Sınır | Anahtar | Değer | Aşılınca |
|---|---|---|---|
| IP hız sınırı | `cl:rl:<sha256(ip)[:32]>` | 10 dk / 12 tarama | `429 rate_limited` + `Retry-After` |
| Ücretsiz kota | `cl:quota:<oturum kimliği>` | 5 tarama | `402 quota_exceeded` |

Depo: Upstash Redis REST. Gerekli ortam değişkenleri
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
**Depo yapılandırılmamışsa uç `503 service_unavailable` döner ve tarama yapılmaz.**

### Başarılı yanıta eklenen alan
```json
"quota": { "used": 2, "limit": 5, "remaining": 3 }
```

### Yeni hata kodları
| Kod | HTTP | Anlamı |
|---|---|---|
| `quota_exceeded` | 402 | Ücretsiz hak bitti; arayüz kayıt modalını açar |
| `service_unavailable` | 503 | Sınır deposu yapılandırılmamış veya ulaşılamıyor |

### Oturum çerezi
`cl_sid` — sunucunun ürettiği 256 bit rastgele kimlik,
`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1 yıl`.
Kota ve (ileride) tarama geçmişi bu kimliğe bağlanır.
