-- Run once in the Supabase SQL editor AFTER the app is deployed to Vercel.
-- Replace the two placeholders. This calls the app's background worker every
-- minute (only when a report is waiting) so reports keep moving even if
-- nobody has the app open.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Keep the secret and URL in Vault rather than in the cron job text.
select vault.create_secret('REPLACE_WITH_CRON_SECRET', 'worker_cron_secret');
select vault.create_secret('https://REPLACE_WITH_YOUR_APP.vercel.app/api/worker', 'worker_url');

select cron.schedule(
  'stripe-report-worker',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'worker_url'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'worker_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  )
  where exists (
    select 1 from public.reports
    where status in ('queued', 'processing')
      and (locked_until is null or locked_until < now())
  );
  $$
);

-- Queue scheduled monthly reports. Runs every 15 minutes; each schedule is
-- queued at most once per month.
select cron.schedule(
  'stripe-report-schedules',
  '*/15 * * * *',
  $$ select public.enqueue_due_schedules(); $$
);
