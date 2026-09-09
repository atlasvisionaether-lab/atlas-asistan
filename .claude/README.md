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

## Her oturumda otomatik çalıştırmak (opsiyonel)

Claude Code'un web/uzak oturumları geçici konteynerlerde çalışır, bu yüzden
`~/.claude/agents/` her yeni oturumda boş başlar. Otomatik kurulum için
`.claude/settings.json` dosyasına şu `SessionStart` hook'unu ekleyin:

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
