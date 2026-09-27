// supabase/functions/atlas-auto-reply/index.ts
// Atlas Asistan — Gelen Kutusu otomatik AI cevabı.
// Tetikleyici: messages tablosuna INSERT (Database Webhook, bkz. supabase/migrations/0011_atlas_auto_reply_trigger.sql).
// Koşul: channel IN ('whatsapp','web_widget') AND is_from_customer = true.
// AI sağlayıcısı: Lovable AI Gateway (LOVABLE_API_KEY) — yoksa OpenAI (OPENAI_API_KEY) fallback'i.
// Sağlık/şikâyet (risk_flag = 'yüksek') mesajlarına otomatik yanıt ÜRETİLMEZ; insan devralma korunur.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MessageRow {
  id: string;
  organization_id: string;
  customer_id: string;
  channel: string;
  direction: string;
  content: string | null;
  risk_flag: string | null;
  is_from_customer: boolean | null;
  created_at: string;
}

interface ServiceRow {
  name: string;
  price: string | null;
  is_active: boolean | null;
}

interface AssistantSettingsRow {
  system_prompt: string;
  fallback_message: string;
  model: string;
  temperature: number;
}

const DEFAULT_SYSTEM_PROMPT =
  "Sen Atlas Asistan'sın, güzellik salonu asistanısın. Kısa, samimi, Türkçe cevap ver. " +
  "Randevu almak isterse müsait saatleri sor. Fiyat sorarsa services listesinden cevap ver.";

const HEALTHY_HANDOVER =
  "Mesajınızı aldım. Bu konuda ekibimiz sizinle daha detaylı ilgilensin; " +
  "kısa süre içinde insan temsilcimiz size dönecek.";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function generateReply(
  messages: Array<{ role: string; content: string }>,
  services: ServiceRow[],
  settings: AssistantSettingsRow | null,
): Promise<string | null> {
  const systemPrompt = settings?.system_prompt || DEFAULT_SYSTEM_PROMPT;
  const fallback = settings?.fallback_message ||
    "Şu an bu soruya yanıt veremiyorum; sizi ekibimize yönlendiriyorum.";
  const temperature = settings?.temperature ?? 0.3;

  const serviceList = services.length
    ? "Hizmetler ve fiyatlar:\n" +
      services.map((s) => `- ${s.name}: ${s.price ?? "fiyat bilgisi yok"}`).join("\n")
    : "Hizmet listesi henüz boş.";

  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");

  const model = settings?.model === "medium" ? "gpt-4o-mini" : "atlas-small";

  const payload = {
    model,
    temperature,
    messages: [
      { role: "system", content: systemPrompt + "\n\n" + serviceList },
      ...messages,
    ],
  };

  try {
    if (lovableKey) {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${lovableKey}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Lovable AI Gateway ${res.status}`);
      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      return typeof content === "string" && content.trim() ? content.trim() : fallback;
    }
    if (openaiKey) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature,
          messages: [
            { role: "system", content: systemPrompt + "\n\n" + serviceList },
            ...messages,
          ],
        }),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}`);
      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      return typeof content === "string" && content.trim() ? content.trim() : fallback;
    }
    // Anahtar yoksa: AI üretimi yapılmaz, fallback mesajı yazılır (mock insan devralma korunur).
    return fallback;
  } catch (_err) {
    return fallback;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Service role client: RLS'i bypass eder, webhook anon çağrısında da yetkilidir.
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let payload: { type?: string; table?: string; record?: MessageRow; record_data?: MessageRow };
  try {
    payload = await req.json();
  } catch (_e) {
    return jsonResponse({ error: "Invalid JSON payload" }, 400);
  }

  const record = payload.record || payload.record_data;
  if (!record) {
    return jsonResponse({ error: "Missing record in payload" }, 400);
  }

  // Webhook payload'ı Supabase Database Webhooks formatındadır; type alanı uyuşmazsa
  // (ör. test çağrısı) işlem yapılır ama yine de koşullar kontrole tabidir.
  if (payload.type && payload.type !== "INSERT" && payload.table !== "messages") {
    return jsonResponse({ skipped: true, reason: "not a messages INSERT" });
  }

  const isNewCustomerMessage =
    record.is_from_customer === true &&
    (record.channel === "whatsapp" || record.channel === "web_widget");

  if (!isNewCustomerMessage) {
    return jsonResponse({ skipped: true, reason: "conditions not met" });
  }

  // Sağlık/şikâyet koruması: risk_flag 'yüksek' ise AI cevabı üretilmez,
  // insan devralma notu eklenir.
  const highRisk = String(record.risk_flag || "").toLowerCase() === "yüksek" ||
    String(record.risk_flag || "").toLowerCase() === "high";

  const orgId = record.organization_id;
  const customerId = record.customer_id;
  if (!orgId || !customerId) {
    return jsonResponse({ skipped: true, reason: "missing organization_id or customer_id" });
  }

  // —— BAYRAK KONTROLLERİ (0013) ————————————————————————————————
  // 1) Org'un asistan ayarları: auto_reply_enabled + working_hours + fallback.
  const { data: flagRows } = await db
    .from("assistant_settings")
    .select("auto_reply_enabled, working_hours, fallback_message")
    .eq("organization_id", orgId)
    .limit(1);
  const flags = (flagRows && flagRows[0]) || null;

  // 1a) AI otomatik cevabı kapalıysa hiçbir cevap yazılmaz.
  if (flags && flags.auto_reply_enabled === false) {
    return jsonResponse({ skipped: true, reason: "auto_reply_disabled" });
  }

  // 1b) Müşteri insan temsilciye aktarılmışsa AI susar.
  const { data: custRows } = await db
    .from("customers")
    .select("is_handled_by_human")
    .eq("id", customerId)
    .limit(1);
  const cust = (custRows && custRows[0]) || null;
  if (cust && cust.is_handled_by_human === true) {
    return jsonResponse({ skipped: true, reason: "handled_by_human" });
  }

  // 1c) Çalışma saatleri dışındaysa AI modeli ÇAĞRILMAZ;
  //     assistant_settings.fallback_message gönderilir (yoksa sessiz geç).
  let outsideWorkingHours = false;
  if (flags && flags.working_hours && flags.working_hours.start && flags.working_hours.end) {
    const nowTR = new Date().toLocaleTimeString("tr-TR", {
      timeZone: "Europe/Istanbul",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const cur = nowTR.split(":").map(Number);
    const start = String(flags.working_hours.start).split(":").map(Number);
    const end = String(flags.working_hours.end).split(":").map(Number);
    const curMin = cur[0] * 60 + cur[1];
    const startMin = start[0] * 60 + start[1];
    const endMin = end[0] * 60 + end[1];
    outsideWorkingHours = curMin < startMin || curMin >= endMin;
  }
  if (outsideWorkingHours) {
    const fb = (flags && flags.fallback_message) || "";
    if (!fb) {
      return jsonResponse({ skipped: true, reason: "outside_working_hours" });
    }
    const { error: fbErr } = await db.from("messages").insert({
      organization_id: orgId,
      customer_id: customerId,
      content: fb,
      channel: record.channel,
      direction: "out",
      is_from_customer: false,
      sender_type: "ai",
      risk_flag: "normal",
      unread: false,
    });
    if (fbErr) {
      return jsonResponse({ error: "fallback insert failed: " + fbErr.message }, 500);
    }
    return jsonResponse({ ok: true, replied: true, fallback: true, customer_id: customerId });
  }
  // ————————————————————————————————————————————————————————

  // b) Son 10 mesaj (context) — eski→yeni sırayla modele verilir.
  const { data: recent, error: recentErr } = await db
    .from("messages")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (recentErr) {
    return jsonResponse({ error: "context fetch failed: " + recentErr.message }, 500);
  }
  const context = (recent || []).slice().reverse().map((m: MessageRow) => ({
    role: m.is_from_customer ? "user" : "assistant",
    content: String(m.content ?? ""),
  }));

  // c) Org'un aktif hizmetleri.
  const { data: services, error: servicesErr } = await db
    .from("services")
    .select("name, price, is_active")
    .eq("organization_id", orgId)
    .eq("is_active", true);
  if (servicesErr) {
    return jsonResponse({ error: "services fetch failed: " + servicesErr.message }, 500);
  }

  // Org'a özel asistan ayarları (0009); yoksa default'lar.
  const { data: settingsRows } = await db
    .from("assistant_settings")
    .select("system_prompt, fallback_message, model, temperature")
    .eq("organization_id", orgId)
    .limit(1);
  const settings = (settingsRows && settingsRows[0]) || null;

  // d) Cevap üretimi (yüksek riskte üretilmez, devralma notu yazılır).
  const reply = highRisk ? HEALTHY_HANDOVER : await generateReply(context, services || [], settings);
  if (!reply) {
    return jsonResponse({ skipped: true, reason: "empty reply" });
  }

  // e) Cevabı messages'a INSERT et.
  const { error: insertErr } = await db.from("messages").insert({
    organization_id: orgId,
    customer_id: customerId,
    content: reply,
    channel: record.channel,
    direction: "out",
    is_from_customer: false,
    sender_type: "ai",
    risk_flag: "normal",
    unread: false,
  });
  if (insertErr) {
    return jsonResponse({ error: "insert failed: " + insertErr.message }, 500);
  }

  // f) customers.last_message_at güncelle.
  const { error: custErr } = await db
    .from("customers")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", customerId);
  if (custErr) {
    // Cevap yazıldı; last_message_at hatası akışı bozmaz.
    console.warn("last_message_at güncellenemedi:", custErr.message);
  }

  return jsonResponse({ ok: true, replied: true, customer_id: customerId, high_risk: highRisk });
});
