import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!browserClient) {
    browserClient = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return browserClient;
}

export async function saveCalculation(slug: string, payload: unknown) {
  const supabase = getSupabaseBrowser();
  if (!supabase) {
    return { saved: false, reason: "Supabase is not configured" };
  }
  const { error } = await supabase.from("calculations").insert({
    product_slug: slug,
    payload,
  });
  if (error) return { saved: false, reason: error.message };
  return { saved: true };
}
