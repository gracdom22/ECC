-- polymarket-edge: paper-trading schema. No real-money or wallet data is stored here.
-- Access model: RLS on every table with no policies, so the public (anon/authenticated)
-- Data API sees nothing. The worker uses the server-side secret key (service_role), which bypasses RLS.

create table public.events (
  id text primary key,
  slug text not null,
  title text not null,
  league text not null,
  start_time timestamptz not null,
  teams jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index events_start_time_idx on public.events (start_time);

create table public.markets (
  id text primary key,
  event_id text not null references public.events (id) on delete cascade,
  condition_id text not null,
  question text not null,
  market_type text not null,
  outcomes jsonb not null,
  clob_token_ids jsonb not null,
  outcome_prices jsonb,
  closed boolean not null default false,
  resolution_status text,
  liquidity numeric,
  updated_at timestamptz not null default now()
);
create index markets_event_id_idx on public.markets (event_id);

create table public.odds_snapshots (
  id bigint generated always as identity primary key,
  fetched_at timestamptz not null default now(),
  odds_event_id text not null,
  sport_key text not null,
  bookmaker text not null,
  commence_time timestamptz not null,
  home_team text not null,
  away_team text not null,
  outcomes jsonb not null,
  fair_probs jsonb,
  overround numeric,
  devig_method text,
  bookmaker_last_update timestamptz,
  event_id text references public.events (id) on delete set null,
  match_score numeric
);
create index odds_snapshots_event_id_idx on public.odds_snapshots (event_id);
create index odds_snapshots_sport_fetched_idx on public.odds_snapshots (sport_key, fetched_at desc);

create table public.signals (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event_id text not null references public.events (id) on delete cascade,
  market_id text not null references public.markets (id) on delete cascade,
  token_id text not null,
  question text not null,
  selection text not null,
  odds_snapshot_id bigint not null references public.odds_snapshots (id) on delete cascade,
  fair_prob numeric not null check (fair_prob > 0 and fair_prob < 1),
  best_ask numeric not null check (best_ask > 0 and best_ask < 1),
  best_bid numeric,
  fee_per_share numeric not null check (fee_per_share >= 0),
  cost numeric not null,
  ev numeric not null,
  edge numeric not null,
  full_kelly numeric not null,
  suggested_stake numeric not null default 0,
  status text not null check (status in (
    'traded', 'below_threshold', 'suspect_edge', 'stale_odds', 'too_close_to_start',
    'not_accepting', 'wide_spread', 'risk_blocked', 'insufficient_liquidity', 'signal_only'
  )),
  reason text,
  unique (token_id, odds_snapshot_id)
);
create index signals_event_id_idx on public.signals (event_id);
create index signals_market_id_idx on public.signals (market_id);
create index signals_odds_snapshot_id_idx on public.signals (odds_snapshot_id);
create index signals_created_at_idx on public.signals (created_at desc);

create table public.paper_trades (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  signal_id bigint references public.signals (id) on delete set null,
  event_id text not null references public.events (id),
  market_id text not null references public.markets (id),
  token_id text not null,
  question text not null,
  selection text not null,
  outcome_index integer not null check (outcome_index >= 0),
  shares numeric not null check (shares > 0),
  avg_price numeric not null check (avg_price > 0 and avg_price < 1),
  fees numeric not null check (fees >= 0),
  cost numeric not null check (cost > 0),
  fair_prob numeric not null,
  ev_at_entry numeric not null,
  status text not null default 'open' check (status in ('open', 'settled', 'void')),
  settled_at timestamptz,
  payout numeric,
  pnl numeric,
  resolution_price numeric
);
-- One paper position per game, enforced in the database as well as in the worker.
create unique index paper_trades_one_per_event_idx on public.paper_trades (event_id);
create index paper_trades_signal_id_idx on public.paper_trades (signal_id);
create index paper_trades_market_id_idx on public.paper_trades (market_id);
create index paper_trades_status_idx on public.paper_trades (status);

-- Append-only ledger of the virtual bankroll. Current cash = balance_after of the latest row.
create table public.bankroll (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('deposit', 'trade_open', 'trade_settle')),
  amount numeric not null,
  balance_after numeric not null check (balance_after >= 0),
  trade_id bigint references public.paper_trades (id) on delete set null,
  note text
);
create index bankroll_trade_id_idx on public.bankroll (trade_id);

-- Audit log of external API usage (Odds API credits in particular).
create table public.api_calls (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  provider text not null,
  endpoint text not null,
  status integer not null,
  cost integer not null default 0,
  remaining integer,
  used integer
);
create index api_calls_provider_endpoint_idx on public.api_calls (provider, endpoint, created_at desc);

alter table public.events enable row level security;
alter table public.markets enable row level security;
alter table public.odds_snapshots enable row level security;
alter table public.signals enable row level security;
alter table public.paper_trades enable row level security;
alter table public.bankroll enable row level security;
alter table public.api_calls enable row level security;

revoke all on public.events, public.markets, public.odds_snapshots, public.signals,
  public.paper_trades, public.bankroll, public.api_calls from anon, authenticated;

create or replace function public.ensure_bankroll(p_starting numeric)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('polymarket_edge_bankroll'));
  if not exists (select 1 from public.bankroll) then
    insert into public.bankroll (kind, amount, balance_after, note)
    values ('deposit', p_starting, p_starting, 'virtual starting bankroll');
  end if;
end;
$$;

create or replace function public.open_paper_trade(p jsonb)
returns public.paper_trades
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cash numeric;
  v_trade public.paper_trades;
begin
  perform pg_advisory_xact_lock(hashtext('polymarket_edge_bankroll'));
  select balance_after into v_cash from public.bankroll order by id desc limit 1;
  if v_cash is null then
    raise exception 'bankroll not initialised';
  end if;
  if (p->>'cost')::numeric > v_cash then
    raise exception 'insufficient paper cash: need %, have %', p->>'cost', v_cash;
  end if;

  insert into public.paper_trades (
    signal_id, event_id, market_id, token_id, question, selection, outcome_index,
    shares, avg_price, fees, cost, fair_prob, ev_at_entry
  ) values (
    nullif(p->>'signal_id', '')::bigint, p->>'event_id', p->>'market_id', p->>'token_id', p->>'question',
    p->>'selection', (p->>'outcome_index')::integer, (p->>'shares')::numeric, (p->>'avg_price')::numeric,
    (p->>'fees')::numeric, (p->>'cost')::numeric, (p->>'fair_prob')::numeric, (p->>'ev_at_entry')::numeric
  )
  returning * into v_trade;

  insert into public.bankroll (kind, amount, balance_after, trade_id)
  values ('trade_open', -v_trade.cost, v_cash - v_trade.cost, v_trade.id);

  return v_trade;
end;
$$;

create or replace function public.settle_paper_trade(
  p_trade_id bigint,
  p_payout numeric,
  p_pnl numeric,
  p_resolution_price numeric
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cash numeric;
begin
  perform pg_advisory_xact_lock(hashtext('polymarket_edge_bankroll'));
  update public.paper_trades
     set status = 'settled', settled_at = now(), payout = p_payout, pnl = p_pnl, resolution_price = p_resolution_price
   where id = p_trade_id and status = 'open';
  if not found then
    return;
  end if;
  select balance_after into v_cash from public.bankroll order by id desc limit 1;
  insert into public.bankroll (kind, amount, balance_after, trade_id)
  values ('trade_settle', p_payout, coalesce(v_cash, 0) + p_payout, p_trade_id);
end;
$$;

revoke all on function public.ensure_bankroll(numeric) from public, anon, authenticated;
revoke all on function public.open_paper_trade(jsonb) from public, anon, authenticated;
revoke all on function public.settle_paper_trade(bigint, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.ensure_bankroll(numeric) to service_role;
grant execute on function public.open_paper_trade(jsonb) to service_role;
grant execute on function public.settle_paper_trade(bigint, numeric, numeric, numeric) to service_role;
