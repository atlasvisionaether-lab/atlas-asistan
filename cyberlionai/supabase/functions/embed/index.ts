// CyberLion AI — embed
//
// Asistan hafızasının anlamsal araması için metni 384 boyutlu vektöre çevirir.
// Model Supabase'in Edge Runtime'ında yerleşik gte-small: metin Supabase
// dışına ÇIKMAZ, yeni bir veri işleyen eklenmez.
//
// GİRDİ / ÇIKTI (OpenAI /embeddings biçimine uyumlu; Vercel tarafındaki
// istemci iki sağlayıcıyı aynı kodla okuyor)
//   POST { input: string | string[] }
//   200  { object: 'list', model: 'gte-small', data: [{ index, embedding: number[384] }] }
//
// KİMLİK DOĞRULAMA
//   Çağıran Vercel sunucu ucudur, tarayıcı DEĞİL. Servis rolü anahtarının
//   üstüne paylaşılan sır (`EMBED_SHARED_SECRET`) sabit zamanlı
//   karşılaştırmayla doğrulanır. Sır diğer işlevlerin sırlarından AYRI.
//
// SINIRLAR
//   En çok 16 metin, her biri en çok 2000 karakter (fazlası kırpılır).
//   Metinler zaten çağıran tarafta maskelenmiştir (ai-redact); yine de HİÇBİR
//   metin loglanmaz.
//
// GİZLİ DEĞİŞKEN (Supabase > Edge Functions > Secrets; depoda DURMAZ)
//   EMBED_SHARED_SECRET — Vercel'deki aynı değer

// deno-lint-ignore-file no-explicit-any
declare const Supabase: any;

const MAX_INPUTS = 16;
const MAX_CHARS = 2000;
const session = new Supabase.ai.Session("gte-small");

function sabitZamanliEsit(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let fark = 0;
  for (let i = 0; i < ea.length; i++) fark |= ea[i] ^ eb[i];
  return fark === 0;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const beklenen = Deno.env.get("EMBED_SHARED_SECRET") || "";
  const gelen = req.headers.get("x-cl-embed-secret") || "";
  if (beklenen.length < 16 || !sabitZamanliEsit(gelen, beklenen)) {
    return json(401, { error: "unauthorized" });
  }

  let body: any;
  try { body = await req.json(); } catch (_) { return json(400, { error: "bad_json" }); }
  const raw = Array.isArray(body?.input) ? body.input : [body?.input];
  if (!raw.length || raw.length > MAX_INPUTS || raw.some((s: unknown) => typeof s !== "string" || !s.trim())) {
    return json(400, { error: "invalid_input" });
  }

  try {
    const data = [];
    for (let i = 0; i < raw.length; i++) {
      const embedding = await session.run(String(raw[i]).slice(0, MAX_CHARS), { mean_pool: true, normalize: true });
      data.push({ index: i, embedding: Array.from(embedding as number[]) });
    }
    return json(200, { object: "list", model: "gte-small", data });
  } catch (_) {
    return json(502, { error: "embed_failed" });
  }
});
