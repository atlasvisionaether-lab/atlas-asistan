---
name: vercel-env
description: Vercel ortam değişkenlerini ve alias durumunu teşhis eder. Bir uç "yapılandırılmamış" dönüyorsa, bir düzeltme etkisiz görünüyorsa veya ortamların hangi Supabase projesine baktığı belirsizse kullan.
---

# Vercel ortam ve alias teşhisi

Vercel projesi: `cyberlionai` (`prj_6Xd9lpaiKtcfrSK64caXpaVYPrC8`),
takım `team_graYs7Q6i40H9YeVURVXXb7b`, bölge `iad1`.

**Env değişkenlerini Claude yazamaz.** Okuma ve teşhis Claude'da, yazma
kullanıcıdadır. İstenen şey bir değişkenin adı ve hangi ortama gireceğidir;
**değeri asla sohbete yazılmaz veya istenmez**.

## Değişkenler ve hangi kod yolunun neye ihtiyacı olduğu

| Değişken | Kullanan |
|---|---|
| `SUPABASE_URL` | hem `_lib/auth.js` hem `_lib/db.js` |
| `SUPABASE_ANON_KEY` | `_lib/auth.js` (kimlik) |
| `SUPABASE_SERVICE_ROLE_KEY` | `_lib/db.js` (tarama kayıtları) |
| `UPSTASH_REDIS_REST_URL` | `_lib/limits.js` (kota / hız sınırı) |
| `UPSTASH_REDIS_REST_TOKEN` | `_lib/limits.js` |

Bu tablo eleme yapmayı sağlar; bu projede iki üretim arızasını çözen mantık budur:

- Kimlik **ve** veritabanı birlikte bozuksa → ortak değişken `SUPABASE_URL` eksiktir.
- Yalnızca veritabanı bozuksa → `SUPABASE_SERVICE_ROLE_KEY` eksiktir.
- Yalnızca kimlik bozuksa → `SUPABASE_ANON_KEY` eksiktir.

`/api/auth/me` `available: false` dönüyorsa: `_lib/auth.js` yalnızca env varlığına
bakar, ağa çıkmaz. Yani bu **kesin olarak** eksik env değişkenidir, Supabase
erişilemezliği değil.

```js
function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  return url && key ? { url: url.replace(/\/+$/, ''), key: key } : null;
}
```

## Düzeltme ölçülemiyorsa: önce alias'a bak

Bir env değişkeni düzeltildiği, redeploy yapıldığı halde davranış değişmiyorsa
ilk şüpheli **env değil, alias'tır**. Vercel'de alan adı alias'ı eski bir üretim
dağıtımına sabit kalabilir; sonraki dağıtımlar hazır görünür ama trafiğe çıkmaz.

`mcp__Vercel__get_deployment` çağır, `idOrUrl: "www.cyberlionai.com"`. Dönen
dağıtımın SHA'sı beklediğinle eşleşmiyorsa alias sabitlenmiştir — kullanıcıdan
promote iste. Alias doğrulanmadan hiçbir ölçüm anlamlı değildir.

## Hangi ortam hangi Supabase projesine bakıyor

Yapılandırma iddiasına güvenme, yazının nereye düştüğünü ölç. Her iki projede
tarama tablosunun satır sayısını ve `max(scanned_at)` değerini koşudan önce ve
sonra karşılaştır.

- Yeni proje (kullanımda): `cyberlionai` / ref `aohsgagiyaseinhmyfub` (eu-central-1)
- Eski proje (dokunulmuyor): `atlas-vision` / ref `nqvuayhedqpgwftonesl`

Yeni proje `atlasvisionaether-lab` organizasyonuna taşındığından
`mcp__Supabase__list_projects` çıktısında **görünmez**; ref ile doğrudan sorgulanır.

## Redeploy sonrası

Redeploy "Build Cache" işaretsiz yapılır. Yeni dağıtım Ready olduktan sonra
önce alias doğrulanır, sonra `prod-verify` koşulur — bu sırayla.

## Sınırlar

Üretim env değişkeni ekleme/değiştirme/silme, secret rotasyonu ve üretim dağıtımı
**açık kullanıcı onayı** gerektirir. Onay hiçbir zaman bir secret'ın sohbette
paylaşılabileceği veya ön yüze yazılabileceği anlamına gelmez.
