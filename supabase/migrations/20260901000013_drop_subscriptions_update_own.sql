-- C-01 : empêcher l'auto-upgrade via client Supabase sur la table legacy subscriptions.
drop policy if exists subscriptions_update_own on public.subscriptions;
