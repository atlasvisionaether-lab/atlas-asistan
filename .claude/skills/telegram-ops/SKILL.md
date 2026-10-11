---
name: telegram-ops
description: Tüm form ve maillerin Telegram'a düşmesi. Küçük ekip otomasyonu.
---
- Bot: @BotFather token -> TELEGRAM_BOT_TOKEN
- Chat ID: TELEGRAM_CHAT_ID
- Endpoint: /api/contact -> sendMessage
- Gmail -> Apps Script -> aynı bota forward
- Mesaj formatı: 🔔 [KAYNAK] İsim | Mail | Mesaj
