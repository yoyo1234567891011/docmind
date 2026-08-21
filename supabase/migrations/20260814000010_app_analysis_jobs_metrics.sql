-- Timings observables pour load/crash (Architecture A).
alter table public.app_analysis_jobs
  add column if not exists metrics jsonb;
