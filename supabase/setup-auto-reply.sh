#!/usr/bin/env bash
# ============================================================
# Atlas Asistan — Otomatik AI cevabı kurulumu (tek komut).
# PR #47 sonrası kalan 4 adımı otomatikleştirir:
#   1) 0011 migration (kolonlar + realtime)
#   2) Secrets (LOVABLE_API_KEY / OPENAI_API_KEY)
#   3) Edge Function deploy
#   4) Webhook (0012: SQL ile pg_net tetikleyicisi)
#   5) Test INSERT + doğrulama sorgusu
#
# Kullanım (kendi terminalinde, supabase CLI login yapılmış olmalı):
#   export SUPABASE_ACCESS_TOKEN=...   # supabase login sonrası gerekmez
#   export LOVABLE_API_KEY=...         # VEYA export OPENAI_API_KEY=sk-...
#   bash supabase/setup-auto-reply.sh
#
# Alternatif: adımları tek tek çalıştırmak için her blok ayrıdır;
# bir adım hata verirse script durur ve hangi adımın kaldığını söyler.
# ============================================================
set -euo pipefail

PROJECT_REF="lfltontezrfcmjntsgix"
FUNCTION_NAME="atlas-auto-reply"
ORG_ID="fff29ed3-f2e3-4837-bdfc-f4e974f366e7"
TEST_CUSTOMER_ID="6e37b8e0-fdce-4837-ab1a-f11b7578c198"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

step() { printf '\n\033[1;34m== %s ==\033[0m\n' "$1"; }
fail() { printf '\033[1;31mHATA: %s\033[0m\n' "$1" >&2; exit 1; }

command -v supabase >/dev/null 2>&1 || fail "supabase CLI bulunamadı. Kurulum: https://supabase.com/docs/guides/cli"

step "ADIM 1/5 — 0011 migration (kolonlar + realtime publication)"
supabase db execute --project-ref "$PROJECT_REF" -f "$REPO_ROOT/supabase/migrations/0011_atlas_auto_reply_trigger.sql" \
  || fail "0011 uygulanamadı. SQL Editor'de elle çalıştır: supabase/migrations/0011_atlas_auto_reply_trigger.sql"
echo "0011 OK."

step "ADIM 2/5 — Secrets"
if [ -n "${LOVABLE_API_KEY:-}" ]; then
  supabase secrets set --project-ref "$PROJECT_REF" LOVABLE_API_KEY="$LOVABLE_API_KEY" \
    || fail "LOVABLE_API_KEY set edilemedi"
  echo "LOVABLE_API_KEY OK."
elif [ -n "${OPENAI_API_KEY:-}" ]; then
  supabase secrets set --project-ref "$PROJECT_REF" OPENAI_API_KEY="$OPENAI_API_KEY" \
    || fail "OPENAI_API_KEY set edilemedi"
  echo "OPENAI_API_KEY OK."
else
  echo "UYARI: LOVABLE_API_KEY / OPENAI_API_KEY tanımlı değil — Edge Function fallback mesajı yazacak."
  echo "Sonra eklemek için: supabase secrets set --project-ref $PROJECT_REF OPENAI_API_KEY=sk-..."
fi

step "ADIM 3/5 — Edge Function deploy"
( cd "$REPO_ROOT" && supabase functions deploy "$FUNCTION_NAME" --project-ref "$PROJECT_REF" --no-verify-jwt ) \
  || fail "deploy başarısız"
echo "Deploy OK: https://$PROJECT_REF.supabase.co/functions/v1/$FUNCTION_NAME"

step "ADIM 4/5 — Webhook (0012: SQL ile pg_net tetikleyicisi)"
supabase db execute --project-ref "$PROJECT_REF" -f "$REPO_ROOT/supabase/migrations/0012_atlas_auto_reply_webhook.sql" \
  || fail "0012 uygulanamadı. Alternatif: Dashboard > Database > Webhooks > Create (Table: messages, Insert, Function: atlas-auto-reply)"
echo "Webhook OK (trigger on_message_insert)."

step "ADIM 5/5 — Test INSERT + doğrulama"
# NOT: direction NOT NULL (0001) olduğundan 'in' verildi.
supabase db execute --project-ref "$PROJECT_REF" <<'SQL'
insert into public.messages (organization_id, customer_id, content, channel, direction, is_from_customer, sender_type, unread)
values ('fff29ed3-f2e3-4837-bdfc-f4e974f366e7','6e37b8e0-fdce-4837-ab1a-f11b7578c198','Selam fiyat nedir?','whatsapp','in', true, 'customer', true);
SQL
echo "Test mesajı eklendi. 5 sn bekleniyor (AI cevabı için)..."
sleep 5
supabase db execute --project-ref "$PROJECT_REF" <<'SQL'
select sender_type, is_from_customer, content, created_at
from public.messages
where customer_id='6e37b8e0-fdce-4837-ab1a-f11b7578c198'
order by created_at desc limit 3;
SQL

printf '\n\033[1;32mKURULUM TAMAM.\033[0m\n'
echo "Beklenen: yukarıdaki sorguda 1 'customer' + 1 'ai' satırı."
echo "Panelde Gelen Kutusu gerçek zamanlı olarak ikisini de göstermeli."
echo "AI cevabı 'fallback_message' ise API key eksiktir (ADIM 2'yi tekrar yap)."
