-- cheque-mcp database schema
-- Run this in your Supabase SQL editor to create all required tables.
-- These tables use Row Level Security (RLS). The MCP server uses the
-- service_role key, which bypasses RLS — so RLS policies are optional
-- but recommended if you also use the anon key in a frontend.

-- ─────────────────────────────────────────────────────────────────────────────
-- parties
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists parties (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  contact_name text,
  phone        text,
  bank_name    text,
  is_active    boolean not null default true,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists parties_user_id_idx on parties(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- cheques
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists cheques (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  party_id               uuid not null references parties(id) on delete restrict,
  cheque_number          text not null,
  bank_name              text not null,
  amount                 numeric(12, 2) not null check (amount > 0),
  issue_date             date not null,
  due_date               date not null,
  status                 text not null default 'PENDING'
                           check (status in ('PENDING','DEPOSITED','PASSED','RETURNED','CANCELLED')),
  return_reason          text,
  auto_transition_blocked boolean not null default false,
  notes                  text,
  deleted_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists cheques_user_id_idx    on cheques(user_id);
create index if not exists cheques_party_id_idx   on cheques(party_id);
create index if not exists cheques_status_idx     on cheques(status);
create index if not exists cheques_due_date_idx   on cheques(due_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- cheque_history
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists cheque_history (
  id          uuid primary key default gen_random_uuid(),
  cheque_id   uuid not null references cheques(id) on delete cascade,
  from_status text not null,
  to_status   text not null,
  changed_by  text not null,   -- 'velo', 'user', etc.
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists cheque_history_cheque_id_idx on cheque_history(cheque_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- daily_deposits
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists daily_deposits (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  amount       numeric(12, 2) not null check (amount > 0),
  deposit_date date not null,
  notes        text,
  created_at   timestamptz not null default now()
);

create index if not exists daily_deposits_user_id_idx      on daily_deposits(user_id);
create index if not exists daily_deposits_deposit_date_idx on daily_deposits(deposit_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- optional: updated_at trigger (keeps updated_at current automatically)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger parties_updated_at
  before update on parties
  for each row execute function set_updated_at();

create trigger cheques_updated_at
  before update on cheques
  for each row execute function set_updated_at();
