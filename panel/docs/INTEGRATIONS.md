# Entegrasyon Planı (Yalnızca Taslak — DEMO)

Bu prototipte hiçbir gerçek entegrasyon kurulu değildir.

| Entegrasyon | Prototip durumu | Yayın öncesi gereken |
|---|---|---|
| WhatsApp Business API | Mock kanal etiketi | Meta/BSP seçimi, onaylı şablonlar, opt-in |
| Instagram DM | Mock kanal etiketi | Meta App Review ve kapsam onayı |
| Google Calendar | Mock eklenti | OAuth, en az yetki ve test |
| CRM | Mock eklenti | Sağlayıcı seçimi ve alan eşleme |
| SMS / ödeme | Yok | Sözleşme, güvenlik ve KVKK değerlendirmesi |

## Zorunlu kurallar
- Secrets yalnızca sunucu tarafında tutulur; istemciye gömülmez.
- Outbound mesajlar için opt-in, onaylı şablon, hedef kitle ve saat kısıtı gerekir.
- Sağlık/şikâyet akışlarında insan devralma önceliklidir.
- Her entegrasyon ayrı onay ve test ile açılır.
