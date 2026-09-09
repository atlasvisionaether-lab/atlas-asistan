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
