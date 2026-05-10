-- ============================================================
-- StreamOps AI — Initial Schema
-- ============================================================
-- Run this in the Supabase SQL editor (or via supabase db push)
-- Enable required extensions first
-- ============================================================

-- pg_cron extension (enable in Supabase dashboard under Database > Extensions)
-- create extension if not exists pg_cron;

-- ============================================================
-- TABLE: xero_connections
-- One row per tenant. Stores OAuth tokens for each Xero org.
-- tenant_id = auth.uid() of the signed-in user.
-- ============================================================
create table if not exists public.xero_connections (
  tenant_id         uuid        primary key references auth.users(id) on delete cascade,
  xero_tenant_id    text        not null,          -- Xero's own org GUID
  xero_org_name     text,
  access_token      text        not null,
  refresh_token     text        not null,
  token_expiry      timestamptz not null,
  scope             text,
  webhook_key       text,                          -- Xero webhook signing key for this connection
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

alter table public.xero_connections enable row level security;

-- Users can only read/write their own connection
create policy "Owner can manage own xero connection"
  on public.xero_connections
  for all
  using  (auth.uid() = tenant_id)
  with check (auth.uid() = tenant_id);

-- Service role (Edge Functions) bypasses RLS automatically


-- ============================================================
-- TABLE: processing_logs
-- Immutable audit trail. One row per invoice processed.
-- ============================================================
create table if not exists public.processing_logs (
  id              uuid        primary key default gen_random_uuid(),
  tenant_id       uuid        not null references auth.users(id) on delete cascade,
  xero_bill_id    text        not null,            -- Xero's bill GUID
  trigger         text        not null check (trigger in ('webhook', 'cron', 'manual')),
  status          text        not null check (status in ('completed', 'flagged', 'error')),
  line_count      int,
  avg_confidence  numeric(5,2),                    -- 0-100, null until processing completes
  error_message   text,
  raw_payload     jsonb,                           -- full Claude response for debugging
  created_at      timestamptz default now()
);

alter table public.processing_logs enable row level security;

-- Users can only see their own logs
create policy "Owner can read own processing logs"
  on public.processing_logs
  for select
  using (auth.uid() = tenant_id);

-- Only service role inserts logs (Edge Functions)
create policy "Service role can insert logs"
  on public.processing_logs
  for insert
  with check (true);  -- service role bypasses RLS; this policy is belt-and-suspenders for anon

-- Indexes for common dashboard queries
create index if not exists processing_logs_tenant_created
  on public.processing_logs (tenant_id, created_at desc);

create index if not exists processing_logs_tenant_bill
  on public.processing_logs (tenant_id, xero_bill_id);


-- ============================================================
-- TABLE: catalogue_cache
-- Cached copy of each tenant's Xero Items (Products & Services).
-- Refreshed on demand and after each successful processing run.
-- ============================================================
create table if not exists public.catalogue_cache (
  id              uuid        primary key default gen_random_uuid(),
  tenant_id       uuid        not null references auth.users(id) on delete cascade,
  xero_item_id    text        not null,
  item_code       text,
  name            text        not null,
  description     text,
  account_code    text,
  is_purchased    boolean     default false,
  unit_price      numeric(12,4),
  updated_at      timestamptz default now(),
  unique (tenant_id, xero_item_id)
);

alter table public.catalogue_cache enable row level security;

create policy "Owner can read own catalogue"
  on public.catalogue_cache
  for select
  using (auth.uid() = tenant_id);

create policy "Service role can manage catalogue"
  on public.catalogue_cache
  for all
  with check (true);

create index if not exists catalogue_cache_tenant
  on public.catalogue_cache (tenant_id);


-- ============================================================
-- TABLE: subscriptions
-- Billing tier per tenant. Managed manually during beta;
-- will be Stripe-webhook-driven in production.
-- ============================================================
create table if not exists public.subscriptions (
  tenant_id       uuid        primary key references auth.users(id) on delete cascade,
  plan            text        not null default 'trial'
                              check (plan in ('trial', 'bronze', 'silver', 'gold', 'suspended')),
  stripe_customer_id      text,
  stripe_subscription_id  text,
  current_period_end      timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table public.subscriptions enable row level security;

create policy "Owner can read own subscription"
  on public.subscriptions
  for select
  using (auth.uid() = tenant_id);

-- Service role manages subscription records via Stripe webhooks


-- ============================================================
-- FUNCTION: updated_at trigger
-- Auto-updates updated_at on any row change.
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger xero_connections_updated_at
  before update on public.xero_connections
  for each row execute procedure public.set_updated_at();

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute procedure public.set_updated_at();

create trigger catalogue_cache_updated_at
  before update on public.catalogue_cache
  for each row execute procedure public.set_updated_at();


-- ============================================================
-- CRON: Token refresh every 25 minutes
-- Requires pg_cron. Enable in Supabase dashboard first.
-- This calls the token-refresh Edge Function via pg_net.
-- Replace YOUR_SUPABASE_PROJECT_REF and YOUR_ANON_KEY below.
-- ============================================================
-- select cron.schedule(
--   'xero-token-refresh',
--   '*/25 * * * *',
--   $$
--   select net.http_post(
--     url := 'https://YOUR_SUPABASE_PROJECT_REF.supabase.co/functions/v1/token-refresh',
--     headers := '{"Authorization": "Bearer YOUR_ANON_KEY", "Content-Type": "application/json"}'::jsonb,
--     body := '{}'::jsonb
--   );
--   $$
-- );

-- ============================================================
-- CRON: Missed-invoice safety net (Mon-Fri, 7am-7pm AEST)
-- Scans for unprocessed bills created in the last 90 minutes.
-- Replace values as above.
-- ============================================================
-- select cron.schedule(
--   'xero-missed-invoice-cron',
--   '0 21-9 * * 1-5',
--   $$
--   select net.http_post(
--     url := 'https://YOUR_SUPABASE_PROJECT_REF.supabase.co/functions/v1/xero-webhook',
--     headers := '{"Authorization": "Bearer YOUR_ANON_KEY", "Content-Type": "application/json"}'::jsonb,
--     body := '{"trigger": "cron"}'::jsonb
--   );
--   $$
-- );
