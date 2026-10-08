-- Run once in the Supabase SQL editor AFTER the app is deployed to Vercel.
-- Replace the two placeholders. This calls the app's background worker every
-- minute so queued reports keep moving even if nobody has the app open.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Keep the secret in Vault rather than in the cron job text.
select vault.create_secret('REPLACE_WITH_CRON_SECRET', 'worker_cron_secret');

select cron.schedule(
  'stripe-report-worker',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://REPLACE_WITH_YOUR_APP.vercel.app/api/worker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'worker_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  )
  -- Skip the call when there is nothing to do.
  where exists (
    select 1 from public.reports
    where status in ('queued', 'processing')
      and (locked_until is null or locked_until < now())
  );
  $$
);
