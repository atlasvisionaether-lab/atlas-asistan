# 13 prompt — tam metinler

Köşeli parantezli alanları gerçek proje bilgisiyle değiştir.

## 01 · PRD yazdır

Yeni bir özellik için problem, kapsam, kullanıcı hikâyeleri ve başarı ölçütlerini
tek dosyada netleştirir.

```
Write a complete PRD for the feature below.

Feature: [DESCRIBE FEATURE]
Users: [WHO USES IT]
Stack: [YOUR STACK]

Include:
* Problem statement + success metrics
* User stories with acceptance criteria
* Scope: what ships in v1, what does not
* Data model changes
* Edge cases + failure states
* Open questions for me to answer

Keep it under 2 pages. Be specific, no filler.
Save it as docs/prd-[feature].md so every later prompt can reference it.
```

## 02 · CLAUDE.md dosyası oluştur

Claude Code'un projeyi, komutları, mimariyi ve ekip kurallarını her oturumda daha
doğru anlaması için CLAUDE.md üretir. (Yerleşik karşılığı: `/init`.)

```
Scan this entire codebase, then generate a CLAUDE.md.

Include:
* What this project is, in 2 lines
* Tech stack + the versions that matter
* Commands: [DEV / BUILD / TEST / LINT]
* Architecture: where things live and why
* Code conventions you actually detect in the code
* Hard rules: [YOUR NON-NEGOTIABLES] -- what to never touch without asking
* Gotchas a new engineer would hit in week 1

Write rules as short imperatives. Nothing generic -- only what is true for THIS
repo. If you are unsure about a rule, ask me instead of inventing it.
```

## 03 · Ultra plan modu

Kod yazmadan önce etkilenecek dosyaları, alternatifleri, riskleri ve geri dönüş
planını çıkartır. (Yerleşik karşılığı: plan modu.)

```
Enter plan mode. Do NOT write any code yet.

Task: [PASTE TASK]
Constraints: [DEADLINE / STACK / NO-GO ZONES]

1. Read every file this task touches, list them with one line on what each does
   today
2. Map current behavior vs target behavior
3. Propose 2-3 approaches with real tradeoffs: complexity, risk, blast radius
4. Pick one and justify it in 3 lines
5. Break it into steps small enough to verify one at a time, each with its own
   check
6. List risks + the exact rollback for each
7. Flag anything touching [AUTH / PAYMENTS / PROD DATA] for my explicit sign-off

Then stop. Show me the plan and wait for my approval before touching a single
file.
```

## 04 · UI/UX tasarım briefi

Bir ekran veya akış için kullanıcı yolculuğundan tasarım token'larına kadar
uygulanabilir bir brief üretir.

```
Create a full UI/UX design brief for: [SCREEN OR FLOW]

Audience: [USERS]
Brand: [COLORS / FONTS / VIBE]

Deliver:
* User journey through the flow, step by step
* Layout per screen: hierarchy, spacing, breakpoints
* Component inventory with every state -- hover, empty, error, loading
* Typography + color tokens
* Motion: what animates, duration, easing
* Accessibility notes

Study patterns from [2-3 PRODUCTS YOU ADMIRE] for direction. Never copy them.
```

## 05 · Kurulum planı

Onaylanmış PRD'yi küçük, doğrulanabilir geliştirme adımlarına böler.

```
Create an implementation plan for: [APPROVED SPEC / PRD]

Rules:
* Sequence steps so the app compiles and runs after EVERY single step
* Each step: files touched, what changes, how I verify it works
* Flag steps needing a migration or new dependency
* Put the riskiest unknowns first
* Size each step: [S / M / L]

Output a numbered build sequence I can run one step at a time. Wait for my "go"
between steps.
```

## 06 · MCP sunucusu bağla

Bir servis için uygun MCP sunucusunu bulur; yoksa güvenli yapılandırmayla kurar.

```
Wire up an MCP server for: [SERVICE / API]
What I need it to do: [JOBS TO BE DONE]

1. Check for an official or well-maintained existing server first -- name your
   source
2. If one exists: exact install command + the .mcp.json config, scoped to this
   project
3. If not: scaffold one with the MCP SDK -- tools, auth, error handling, typed
   responses
4. Add ONLY the tools I will actually use: [LIST]
5. Wire secrets through [ENV VARS], never hardcode keys in the config file
6. Verify the connection and call one tool end to end, show me the output
7. Document each tool in 1 line so future sessions know when to reach for it
```

## 07 · Veri tabanı bağla

Bağlantı, şema, migration, erişim kuralları ve doğrulama akışını kurar.

```
Connect this app to [POSTGRES / SUPABASE / YOUR DB].

* Pick the client that fits this stack, justify it in 1 line
* Env vars: name them, add to .env.example, never commit real values
* Schema: tables for [ENTITIES] with types, relations, and indexes for
  [HOT QUERIES]
* Create + run the migrations, and show me the rollback for each one
* One typed query helper per table -- no raw SQL scattered through components
* Access rules / row-level security if this is [MULTI-TENANT]
* Connection pooling if we are serverless

Then prove it: seed one row, read it back, show me the output.
```

## 08 · Güvenlik açıklarını bul

Yalnızca inceleme yetkin olan kod tabanlarında kullan. (Yerleşik karşılığı:
`/security-review`.)

```
Audit this codebase for security gaps. Attack it like you want in.

Focus areas: [AUTH / PAYMENTS / USER DATA]

Check:
* Secrets in code, config, or git history
* Injection: SQL, XSS, command, path traversal
* Auth: routes missing checks, weak sessions, broken redirects
* IDOR: can user A read user B's data?
* File uploads + input validation on every form
* Dependency CVEs -- run the audit, read it
* Rate limiting on [EXPENSIVE ENDPOINTS]
* What leaks through error messages and logs

Rank findings by severity with exact file:line, fix the critical ones now, and
list the rest as tickets with effort estimates.
```

## 09 · Debug et

Tahmin yerine kanıtla kök nedene ulaşır.

```
Debug this error. Do NOT guess.

Error: [PASTE FULL ERROR + STACK TRACE]
When it happens: [STEPS TO REPRODUCE]

1. Read the stack trace, open the exact files involved
2. State expected vs actual behavior in 1 line
3. List 3 hypotheses, ranked by likelihood
4. Prove or kill each one with logs or a tiny test -- evidence, not vibes
5. Fix the root cause, not the symptom
6. Search the repo for the same pattern -- if it can break here, it breaks
   elsewhere
7. Add a regression test that fails without the fix
8. Tell me in 2 lines why it broke and why it can never break this way again
```

## 10 · Uygulamanı test et (Playwright E2E)

```
Write Playwright E2E tests for: [AKIŞ]
Stack: [KULLANDIĞIN STACK]   CI: [GITHUB ACTIONS / DİĞERİ]

* Money paths first: [KAYIT OLMA / ÖDEME / ANA AKSİYON]
* Test what the user sees, not implementation details
* Selectors: roles and labels, never brittle CSS chains
* One unhappy path per flow: bad input, network failure, expired session
* Tests stay independent -- any order, zero shared state, each seeds its own data
* Headless in CI, headed locally for debugging
* Screenshots + traces on failure only

Run the suite, show me the results, fix what fails, and tell me what the suite
still does NOT cover.
```

## 11 · Ölü kodu temizle

```
Find and delete dead code in this repo.
Scope: [TÜM REPO / BELİRLİ KLASÖR]

* Unused exports, components, hooks, utils
* Unreachable branches + commented-out blocks
* package.json dependencies nothing imports
* Stale feature flags stuck always-on or always-off
* Duplicate logic that should merge into one
* Dead CSS classes and unused assets

Verify with a search before EVERY deletion -- dynamic imports and string
references count.
Delete in small commits, run [BUILD + TESTLER] after each one, and report total
lines removed plus anything you were not 100% sure about.
```

## 12 · Temiz git commit'leri yaz

```
Commit my staged changes properly.
Convention: [CONVENTIONAL COMMITS / KENDİ FORMATIN]

* Split unrelated changes into separate commits
* Format: type(scope): what changed and why
          feat / fix / refactor / chore / docs / test
* Subject under 50 chars, imperative mood
* Body explains the WHY, wrapped at 72
* Reference the ticket: [TICKET NUMARASI]
* Never mix a refactor with a behavior change in one commit
* Never commit [GİZLİ BİLGİLER / .ENV / OLUŞTURULAN DOSYALAR]

Show me the plan -- files per commit + messages before you commit anything.
Then commit one at a time so I can stop you between them.
```

## 13 · Görevi bir skill'e dönüştür

(Yerleşik karşılığı: `skill-creator` skill'i.)

```
Tekrarladığım bu görevi bir Claude Code skill'ine dönüştür.
Sürekli yaptığım görev: [GÖREVİ VE ADIMLARI AÇIKLA]

* .claude/skills/[İSİM]/SKILL.md oluştur
* Frontmatter: gerçekten kullandığım tetikleyici ifadeleri içeren isim + açıklama
* Body: numaralı iş akışı, kullandığım kurallar, edge case'ler
* Benden neyi sorması gerektiği ve neyi kendi başına çıkarabileceği
* 'Done' durumunun nasıl göründüğü

Sonra skill'i gerçek bir örnek üzerinde dry-run yap ve çıktı, bunu manuel
yaptığım şekille eşleşene kadar iyileştir.
```

---

Kaynak: "13 Güçlü Claude Code Promptu · Prompt Rehberi" — talhaunuvai.
