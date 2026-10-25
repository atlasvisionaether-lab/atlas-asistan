/**
 * atlas-auto-reply uçtan uca akış sınaması (Deno): gerçek index.ts çalışır,
 * Deno.serve yakalanır; PostgREST ve OpenAI sahte (global fetch).
 *
 *   docker run --rm -v "$PWD:/app:ro" -w /app denoland/deno:2.1.4 \
 *     deno run --no-lock --allow-env --allow-net=esm.sh --allow-read tools/atlas-auto-reply-flow-test.ts
 *
 * Sınananlar: yeni müşteriye karşılama BİR KEZ; yalnız selamda ikinci mesaj
 * yok; soruda karşılama + AI cevabı (AI'a "tekrar selamlama" notu, karşılama
 * bağlamdan çıkarılmış); mesai dışında after_hours_message, boşsa fallback;
 * yüksek riskte karşılama yok; karşılama boşsa yok; greeted_at sütunu yoksa
 * akış sürer.
 */

type Row = Record<string, unknown>;

const ORG = "33333333-3333-4333-8333-333333333333";
const INSIDE = { start: "00:00", end: "23:59" };
const OUTSIDE = { start: "00:00", end: "00:00" };

let settings: Row = {};
let customers: Record<string, Row> = {};
let messages: Row[] = [];
let aiCalls: { system: string; last: Row }[] = [];
let greetedColumnMissing = false;
let seq = 0;

function json(status: number, body: unknown) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = (init?.method || "GET").toUpperCase();
  const q = url.searchParams;
  const headers = new Headers(init?.headers);
  const wantsObject = (headers.get("Accept") || "").includes("vnd.pgrst.object");
  const body = init?.body ? JSON.parse(String(init.body)) : null;

  if (url.host === "api.openai.com") {
    const msgs = body.messages as Row[];
    aiCalls.push({ system: String(msgs[0].content), last: msgs[msgs.length - 1] });
    return json(200, { choices: [{ message: { content: "AI cevap" } }] });
  }
  if (url.host !== "db.test") throw new Error("beklenmeyen ağ: " + url.href);

  const table = url.pathname.replace("/rest/v1/", "");
  const eq = (k: string) => (q.get(k) || "").replace(/^eq\./, "");

  if (table === "assistant_settings") return json(200, [settings]);
  if (table === "services") return json(200, [{ name: "Lazer", price: "1000", is_active: true }]);
  if (table === "customers" && method === "GET") return json(200, [{ is_handled_by_human: false }]);
  if (table === "customers" && method === "PATCH") {
    const c = customers[eq("id")];
    if (q.get("greeted_at") === "is.null") {
      if (greetedColumnMissing) return json(400, { code: "42703", message: 'column "greeted_at" does not exist' });
      if (c.greeted_at) return json(200, []);
      c.greeted_at = body.greeted_at;
      return json(200, [{ id: eq("id") }]);
    }
    Object.assign(c, body);
    return json(204, null);
  }
  if (table === "messages" && method === "POST") {
    const row = Object.assign({ id: "m" + (++seq), created_at: new Date(Date.now() + seq).toISOString() }, body);
    messages.push(row);
    return wantsObject ? json(201, { id: row.id }) : json(201, null);
  }
  if (table === "messages" && method === "GET") {
    const rows = messages.filter((m) => m.customer_id === eq("customer_id"))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10);
    return json(200, rows);
  }
  throw new Error("beklenmeyen istek: " + method + " " + url.pathname + url.search);
};

Deno.env.set("SUPABASE_URL", "https://db.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");
Deno.env.set("OPENAI_API_KEY", "sk-test");
Deno.env.delete("LOVABLE_API_KEY");

let handler: ((req: Request) => Promise<Response>) | null = null;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (h: (req: Request) => Promise<Response>) => { handler = h; return {}; };
await import("../supabase/functions/atlas-auto-reply/index.ts");

/** Müşteri mesajı gelir (tetikleyici satırı yazmış gibi) → fonksiyon çağrılır. */
async function inbound(customerId: string, content: string, risk = "normal") {
  if (!customers[customerId]) customers[customerId] = { greeted_at: null };
  const rec = { id: "m" + (++seq), organization_id: ORG, customer_id: customerId, channel: "whatsapp", direction: "in",
    content, risk_flag: risk, is_from_customer: true, created_at: new Date(Date.now() + seq).toISOString() };
  messages.push(rec);
  const before = messages.length;
  const res = await handler!(new Request("http://fn", { method: "POST", body: JSON.stringify({ type: "INSERT", table: "messages", record: rec }) }));
  const out = messages.slice(before).map((m) => String(m.content));
  return { status: res.status, body: await res.json(), out };
}

let hata = 0;
function sina(ad: string, bulunan: unknown, beklenen: unknown) {
  const ok = JSON.stringify(bulunan) === JSON.stringify(beklenen);
  if (!ok) hata++;
  console.log((ok ? "ok   " : "HATA ") + ad + (ok ? "" : " — bulunan " + JSON.stringify(bulunan) + ", beklenen " + JSON.stringify(beklenen)));
}

settings = { auto_reply_enabled: true, working_hours: INSIDE, greeting_message: "Hoş geldiniz! Ben Işıl'ın asistanı.",
  after_hours_message: "Şu an kapalıyız, 09:00'da döneceğiz.", fallback_message: "Ekibimiz dönecek.", system_prompt: "SP", model: "small", temperature: 0.3 };

let r = await inbound("c1", "Merhaba");
sina("yeni müşteri + yalnız selam → yalnız karşılama", r.out, ["Hoş geldiniz! Ben Işıl'ın asistanı."]);
sina("yalnız selamda AI çağrılmadı", aiCalls.length, 0);

r = await inbound("c1", "Lazer ne kadar?");
sina("ikinci mesaj → karşılama tekrar YOK, AI cevabı", r.out, ["AI cevap"]);
sina("ikinci mesajda AI'a karşılama notu yok", aiCalls[0].system.includes("karşılama mesajı gönderildi"), false);

r = await inbound("c2", "Merhaba, lazer ne kadar?");
sina("yeni müşteri + soru → karşılama + AI", r.out, ["Hoş geldiniz! Ben Işıl'ın asistanı.", "AI cevap"]);
sina("AI'a 'tekrar selamlama' notu", aiCalls[1].system.includes("Tekrar selamlama"), true);
sina("AI bağlamı müşteri mesajıyla bitiyor (karşılama çıkarıldı)", [aiCalls[1].last.role, aiCalls[1].last.content], ["user", "Merhaba, lazer ne kadar?"]);

settings.working_hours = OUTSIDE;
r = await inbound("c3", "Merhaba");
sina("mesai dışı → after_hours_message (karşılama yok)", r.out, ["Şu an kapalıyız, 09:00'da döneceğiz."]);
settings.after_hours_message = "  ";
r = await inbound("c3", "Fiyat?");
sina("mesai dışı, after_hours boş → fallback", r.out, ["Ekibimiz dönecek."]);
settings.fallback_message = "";
r = await inbound("c3", "Fiyat?");
sina("mesai dışı, ikisi de boş → cevap yok", [r.out, r.body.reason], [[], "outside_working_hours"]);
settings.working_hours = INSIDE;
sina("mesai dışında karşılama işaretlenmedi (ertesi gün karşılanır)", customers.c3.greeted_at, null);

r = await inbound("c4", "Şikayetim var, cildim yandı", "yüksek");
sina("yüksek risk → karşılama yok, devralma notu", [r.out.length, r.out[0].startsWith("Mesajınızı aldım")], [1, true]);
sina("yüksek riskte greeted_at işaretlenmedi", customers.c4.greeted_at, null);

settings.greeting_message = "";
r = await inbound("c5", "Merhaba");
sina("karşılama boş → doğrudan AI", r.out, ["AI cevap"]);

settings.greeting_message = "Hoş geldiniz!";
greetedColumnMissing = true;
r = await inbound("c6", "Merhaba");
sina("greeted_at sütunu yok (0019 yok) → karşılamasız AI, akış sürer", [r.status, r.out], [200, ["AI cevap"]]);

console.log(hata ? "\n" + hata + " sınama BAŞARISIZ" : "\nTümü geçti");
Deno.exit(hata ? 1 : 0);
