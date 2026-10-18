# Agency Agents kurulumu

[msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) —
279 uzmanlaşmış Claude Code alt-ajanı (engineering, design, security, finance,
marketing, testing, product, ...).

## Kurulum

```bash
bash .claude/scripts/setup-agency-agents.sh
```

Script idempotenttir: ajanlar zaten kuruluysa hiçbir şey yapmaz. Aksi halde
depoyu `~/.cache/agency-agents` altına shallow-clone eder ve
`scripts/install.sh --tool claude-code` ile `~/.claude/agents/` içine kurar.

Ortam değişkenleriyle hedef değiştirilebilir:

| Değişken | Varsayılan | Anlamı |
|---|---|---|
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Ajanların kurulacağı Claude Code dizini |
| `AGENCY_AGENTS_DIR` | `~/.cache/agency-agents` | Depo klonunun tutulduğu yer |

## Her oturumda otomatik çalıştırma

Claude Code'un web/uzak oturumları geçici konteynerlerde çalışır, bu yüzden
`~/.claude/agents/` her yeni oturumda boş başlar. Bunu kapatmak için
`.claude/settings.json` içindeki `SessionStart` hook'unu kaldırın:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/scripts/setup-agency-agents.sh\"",
            "timeout": 300
          }
        ]
      }
    ]
  }
}
```

## Kullanım

Kurulumdan sonra ajanlar Task/Agent aracıyla adlarıyla çağrılır, örn.
`engineering-frontend-developer`, `design-ui-designer`, `security-auditor`.
Tüm liste: `ls ~/.claude/agents/`

---

# Skill'ler

`.claude/skills/` altındaki skill'ler bu projede otomatik yüklenir. Başka bir
projede kullanmak için tüm `.claude/` klasörünü oraya kopyalayın, ya da tek tek:
`cp -r .claude/skills/<isim> ~/.claude/skills/`

| Skill | Ne işe yarar |
|---|---|
| `profesyonel-web-sitesi` | Web sitesi / landing page tasarımında jenerik "AI slop" görünümünü engeller; marka kimliği + 8px boşluk sistemi + mikro-detayları önden karara bağlar, sonunda kanıt ister |
| `karar-konseyi` | Geri dönüşü zor kararları beş zıt danışman rolüyle test eder, başkan adımıyla tek sonuca bağlar (Karpathy'nin LLM Council mantığı) |
| `uygulama-buyume-sistemi` | Üretime hazır uygulama → n8n otomasyonu → organik dağıtım, üç aşamalı |
| `claude-code-prompt-kitapligi` | PRD, CLAUDE.md, plan modu, MCP, veri tabanı, güvenlik denetimi, debug, E2E test, ölü kod, commit ve skill'e dönüştürme için 13 hazır iş akışı |

Kaynaklar: @burhankocabiyik (web sitesi, LLM Council, uygulama & büyüme kitleri),
talhaunuvai (13 prompt rehberi), Andrej Karpathy (`llm-council` projesi).
