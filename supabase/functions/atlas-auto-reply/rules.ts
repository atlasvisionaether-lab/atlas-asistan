// supabase/functions/atlas-auto-reply/rules.ts
// Otomatik cevabın saf karar kuralları: veritabanı ve ağ yok.
// index.ts (Deno) kullanır; tools/atlas-auto-reply-rules-test.mjs (Node) sınar.

export interface ReplySettings {
  greeting_message?: string | null;
  after_hours_message?: string | null;
  fallback_message?: string | null;
}

function text(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Mesai dışında gönderilecek metin: önce "Çalışma saatleri dışı mesajı",
 * boşsa "Fallback / Anlamadım mesajı", o da boşsa "" (cevap gönderilmez).
 */
export function afterHoursText(s: ReplySettings | null): string {
  if (!s) return "";
  return text(s.after_hours_message) || text(s.fallback_message);
}

/** Karşılama metni; ayar yoksa ya da boşsa "" (karşılama gönderilmez). */
export function greetingText(s: ReplySettings | null): string {
  return s ? text(s.greeting_message) : "";
}

/**
 * Yalnızca selam veren mesaj ("Merhaba", "slm", "iyi akşamlar!" …).
 * Karşılama zaten gönderildiyse bu mesaja ayrıca AI cevabı üretilmez;
 * soru içeren mesaja (ör. "Merhaba, lazer ne kadar?") üretilir.
 */
const GREETING_WORDS = [
  "merhaba", "merhabalar", "mrb", "mrhb", "selam", "selamlar", "slm", "sa", "selamün aleyküm", "selamun aleykum",
  "günaydın", "gunaydin", "iyi günler", "iyi gunler", "iyi akşamlar", "iyi aksamlar", "iyi geceler",
  "hey", "hi", "hello", "hallo", "hola", "alo", "kolay gelsin", "merhaba kolay gelsin", "selam kolay gelsin",
];

export function isPureGreeting(message: string | null | undefined): boolean {
  const norm = String(message || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[!.,?…\s]+/g, " ")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .trim();
  return norm.length > 0 && GREETING_WORDS.includes(norm);
}

/** AI cevabından önce karşılama gönderildiyse sistem istemine eklenen not. */
export function greetedNote(greeting: string): string {
  return "Müşteriye az önce şu karşılama mesajı gönderildi: \"" + greeting + "\". " +
    "Tekrar selamlama ya da kendini yeniden tanıtma; doğrudan müşterinin mesajına cevap ver.";
}
