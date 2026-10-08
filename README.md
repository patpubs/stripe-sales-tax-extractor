# Stripe Sales Tax Extractor

Internal app for pulling sales by US state from one or more Stripe accounts, for
state sales tax filing.

- Pick a Stripe account, a state (or all states), and a month or date range.
- The report runs in the background, paging through every charge in the period,
  so very large accounts work. Progress shows live and you can leave the page.
- Each report shows gross sales, refunds, net taxable sales and transaction count.
- CSV downloads: itemized, total (gross), net (minus refunds), sales with no
  refunds, and a summary by state. Every download is logged in Download history.
- No public sign-up. The first account (the super admin) invites everyone else.

Stack: Next.js on Vercel, Supabase (Postgres + Auth).

## How it works

**Stripe keys.** Each account uses a Stripe *restricted* key with read access to
Charges and Customers only. When added, the key is checked against Stripe,
encrypted with AES-256-GCM using `STRIPE_KEY_ENCRYPTION_KEY` (held only in
Vercel), and stored in Supabase. The browser never receives a key, and neither
Supabase nor Vercel alone can read one. All tables have row level security on
with no policies, so the public Supabase API exposes nothing; the server reads
data with the service role only after checking who is signed in.

**Which state a sale belongs to.** Shipping address first, then the card's
billing address, then the customer's saved shipping address, then the
customer's address. Only US addresses count. State names are normalized ("OK",
"Oklahoma", "Okla." all match). Only succeeded, captured charges are included.

**Refunds** are the amount refunded on each sale in the period, as of when the
report ran. Use the re-run button on a finished report to pick up later refunds.

**Periods** are in the timezone set on the Stripe account (default
America/Chicago); month reports run from local midnight on the 1st to local
midnight on the 1st of the next month.

**Background jobs.** A report is a row in `reports` with a Stripe pagination
cursor. `/api/worker` leases the next report, fetches pages of 100 charges,
saves matching rows and the cursor after every page, and re-triggers itself
before Vercel's time limit. If anything dies mid-run the lease expires and the
next run resumes from the cursor. Supabase `pg_cron` calls the worker every
minute as a safety net. Transient Stripe errors are retried; a report fails
after 8 errors and can be resumed from where it stopped.

## Setup

1. **Supabase**: create a project, then run
   `supabase/migrations/20261008000000_init.sql` in the SQL editor (or
   `supabase db push`). In Authentication → Sign In / Providers, turn **off**
   "Allow new users to sign up".
2. **Vercel**: import this repo and set the variables from `.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `STRIPE_KEY_ENCRYPTION_KEY`: any random string of 32+ characters (or `openssl rand -base64 32`)
   - `CRON_SECRET`: another random string of 32+ characters
   - `SUPER_ADMIN_EMAIL`: the only email allowed to create the first account
   - `NEXT_PUBLIC_SITE_URL`: the production URL, e.g. `https://sales-tax.vercel.app`
3. **Cron**: after the first deploy, edit and run `supabase/cron.sql`.
4. **Supabase Auth URL**: in Authentication → URL Configuration, set Site URL to
   the production URL.
5. Open the app. You'll be sent to `/setup` to create the super admin account
   with `SUPER_ADMIN_EMAIL`. After that, `/setup` is closed for good.
6. Go to **Stripe accounts** and connect each account with a restricted key
   (Developers → API keys → Create restricted key; Read on Charges and
   Customers, everything else None).
7. Go to **Users** to invite people. The app gives you a one-time link to send
   them; they set their own password.

## Development

```
npm install
cp .env.example .env.local   # fill in
npm run dev
npm test                      # unit tests (periods, state matching, CSV)
```
