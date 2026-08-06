-- =============================================================================
-- DocMind — migration 004: Stripe billing (Premium)
-- =============================================================================

-- Ajoute premium au catalogue plans (free / pro / team déjà présents)
do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on e.enumtypid = t.oid
    where t.typname = 'subscription_plan'
      and e.enumlabel = 'premium'
  ) then
    alter type public.subscription_plan add value 'premium';
  end if;
end
$$;

alter table public.subscriptions
  add column if not exists stripe_price_id text,
  add column if not exists canceled_at timestamptz;

create index if not exists subscriptions_stripe_customer_idx
  on public.subscriptions (stripe_customer_id)
  where stripe_customer_id is not null;

create index if not exists subscriptions_stripe_subscription_idx
  on public.subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- Lecture / update own subscription (déjà partiellement couvert) —
-- assure les policies update pour sync webhook service_role vs user.
drop policy if exists subscriptions_update_own on public.subscriptions;
create policy subscriptions_update_own
  on public.subscriptions for update
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());
