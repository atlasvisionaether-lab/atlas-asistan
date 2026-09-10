# Proje skill'leri

Bu dizindeki her `SKILL.md`, Claude Code'un iş bağlama göre yüklediği bir
yetenek tanımıdır. `description` alanı **ne zaman** yükleneceğini belirler;
gövde de o işin bu projedeki doğru yapılışını anlatır.

| Skill | Ne zaman devreye girer |
|---|---|
| `prod-verify` | Üretim dağıtımı, promote/rollback, "üretimde çalışıyor mu" |
| `deploy-verify` | Preview'da kimlik akışının uçtan uca doğrulanması |
| `vercel-env` | Env değişkeni teşhisi, alias sabitlenmesi şüphesi |
| `supabase-migration` | Şema, kısıt, indeks, RLS, GRANT değişikliği |
| `security-scanner` | Tarama kuralı/puanlama, CSP, secret sızıntısı, SSRF |

## Bunlar nereden gelmiyor

Bu skill'ler dış depolardan (`anthropics/skills`, `okenwa/claude-skills`,
`ComposioHQ/awesome-claude-skills`, `obra/superpowers`) kopyalanmadı. İki sebep:

1. O depolar bu oturumun GitHub kapsamı dışında; içerikleri okunamadı.
2. Kopyalansalar da uymazlardı. Onlar Next.js/Python/npm yığınları varsayar;
   bizim yığınımız derleme adımı olmayan tek dosyalık `index.html` + CommonJS
   Vercel serverless fonksiyonlarıdır. Çalışmayan bir komut listesi, komut
   listesi olmamasından kötüdür.

Bunun yerine her skill bu depodaki **gerçek** betiklerden ve iş akışlarından
yazıldı: `tools/prod-verify.sh`, `tools/preview-verify.sh`, `tools/csp-hashes.py`,
`tools/feeds-probe.sh`, `.github/workflows/*.yml`, `db/migrations/*.sql`.
Adı geçen her dosya yolunun var olduğu doğrulandı.

Gövdelerdeki uyarıların çoğu bu projede **gerçekten yaşanmış** arızalardan
geliyor — alias sabitlenmesi kaynaklı üretim kesintisi, eksik `SUPABASE_URL`,
varsayılan dalda kayıtlı olmayan `workflow_dispatch`, CSP hash'i yenilenmeden
engellenen script, sızıntı kontrolündeki yanlış alarm. Bu yüzden genel tavsiye
değil, ölçülmüş vaka notlarıdır.

## Yeni skill eklerken

- Dizin adı ile `name` alanı birebir aynı olmalı.
- `description` "ne zaman kullanılacağını" yazmalı, ne yaptığını değil.
- Gövdede adı geçen her komut ve dosya yolu gerçekten var olmalı — doğrula.
- Secret değeri, anahtar veya şifre yazma.
