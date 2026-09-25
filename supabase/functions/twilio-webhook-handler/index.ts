// supabase/functions/twilio-webhook-handler/index.ts
// Aşama 4B-2.ii: Twilio WhatsApp webhook → routing + first-touch müşteri + retry-safe mesaj yazımı.
// Secret YOK: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY Supabase tarafından runtime'da inject edilir.
// İMZA DOĞRULAMA BİLİNÇLİ YOK (sandbox'ta TWILIO_AUTH_TOKEN yok) → Adım 7'de eklenecek, uydurma.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Twilio "whatsapp:+90…" → "+90…" (E.164 normalize).
// BORÇ (Adım 7): production'da kalıcı kimlik Meta WaId'e geçer; şimdilik From/To numara bazlı.
const norm = (s: unknown): string => String(s ?? "").replace(/^whatsapp:/, "").trim();

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(url, key); // service_role → RLS bypass; izolasyon KODDA (aşağıda).

    const form = await req.formData();
    const from = norm(form.get("From"));
    const to = norm(form.get("To"));
    const body = String(form.get("Body") ?? "");
    const sid = String(form.get("MessageSid") ?? "");

    // 1) ROUTING: To → organization (whatsapp_number eşleşmesi, DB-tabanlı, env-agnostic).
    const { data: org, error: oe } = await db
      .from("organizations").select("id").eq("whatsapp_number", to).maybeSingle();
    if (oe) throw new Error(`org lookup: ${oe.message}`);
    if (!org) {
      // Bilinçli 200 (retry load'u önle) + net log. Seed (4B-3) deploy'dan ÖNCE test'ten SONRA değil, önce → bu satır test'te tetiklenmez.
      console.log(`[twilio-webhook] ROUTING_MISS to=${to} sid=${sid}`);
      return new Response("", { status: 200, headers: corsHeaders });
    }
    const orgId = org.id;

    // 2) FIRST-TOUCH MÜŞTERİ: insert-then-catch-23505-then-select (partial composite unique uyumlu, race-safe).
    let customerId: string | null = null;
    const { data: cIns, error: cErr } = await db
      .from("customers")
      .insert({ organization_id: orgId, wa_id: from, phone: from, lead_status: "new" })
      .select("id").single();
    if (!cErr && cIns) customerId = cIns.id;
    else if (cErr && cErr.code === "23505") {
      const { data: cEx } = await db.from("customers").select("id")
        .eq("organization_id", orgId).eq("wa_id", from).maybeSingle();
      customerId = cEx?.id ?? null;
    } else throw new Error(`customer upsert: ${cErr?.message}`);
    // consent_at bilinçli dokunulmuyor → NULL (opt-in ayrı, Adım 6).

    // 3) MESAJ YAZIMI (retry-safe): twilio_sid partial unique → 23505 = dup, sessizce skip.
    const { error: mErr } = await db.from("messages").insert({
      organization_id: orgId,
      customer_id: customerId,
      channel: "whatsapp",
      direction: "inbound",
      content: body,
      wa_id: from,
      twilio_sid: sid,
      risk_flag: "normal", // BORÇ (Adım 6): keyword/şikâyet taraması burada devreye girer.
    });
    if (mErr && mErr.code !== "23505") throw new Error(`message insert: ${mErr.message}`);
    const dup = mErr?.code === "23505";

    // PII notu (Adım 6): from/wa_id production'da maskelenecek; sandbox'ta kendi numaran, zararsız.
    console.log(`[twilio-webhook] org=${orgId} cust=${customerId} sid=${sid} dup=${dup} body="${body}"`);

    return new Response("", { status: 200, headers: corsHeaders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[twilio-webhook] HATA: ${msg}`);
    return new Response("handler error", { status: 500, headers: corsHeaders });
  }
});
