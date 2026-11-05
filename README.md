# Calii Invoice Reader

A small invoice-checking step before Retool: **select hub → upload invoice photos → review Calii items and pieces → copy or export**. Pending products stay separate until confirmed. This app does not update Retool inventory.

## Continuing this work

**Read [CLAUDE.md](CLAUDE.md) first** — current design (`lean/`), measured results, working rules and the remaining plan. Old handoffs are archived and must not be followed.

## Development

Use Node 24. Install and run:

```sh
npm ci
npm run dev
```

Vite serves the local preview. Use official Netlify CLI `netlify dev` for authenticated function integration. Keep development on loopback; never expose private fixture routes through a public tunnel.

## Deployment

Import this repository in Netlify and use its `netlify.toml`: build `npm run build`, publish `dist`, functions `netlify/functions`, Node 24.

Configure the public Supabase URL/publishable key for Build scope; server Supabase URL/secret key and Anthropic key/model for Functions scope. Copy `.env.example` to ignored `.env.local` for local development. Server secrets must never use `VITE_` variables. Set the final domain in Supabase Auth settings and disable public signup.

Apply all SQL files in `supabase/migrations` in filename order for a new database (for the shared armado-ch project, use `supabase/shared-project/setup.sql`, then the later migrations one by one). Provision a company and invited users; administrator members see all eight hubs, receivers need explicit hub assignments. RLS protects shared history and private photo/catalog storage. Internal policy helpers live in an unexposed schema; mutations are server-only.

AI reads have no app-imposed daily cap or attempt limit; a receiver can retry a failed read. The job lease still prevents processing one job twice. If the Anthropic account runs out of credit, the invoice shows "Error de lectura, favor de capturar directo en Retool y contactar a José…".

Sign-in: receivers use **Entrar con Google** with their @calii.com account. On first sign-in they join as a receiver with access to every active hub (`server/auth.ts` `joinWithGoogle`; domain from `ALLOWED_EMAIL_DOMAIN`, default `calii.com`). Any other Google account is refused with "Usa tu cuenta de Calii (@calii.com)…". Email/password stays available for admins. Hubs added later are not assigned to existing receivers automatically.

Setup (once): Google Cloud console → APIs & Services → Credentials → OAuth client ID (Web), authorized redirect URI `https://<project>.supabase.co/auth/v1/callback`; Supabase → Authentication → Sign In / Providers → Google: enable, paste client ID and secret; Supabase → Authentication → URL Configuration: Site URL = the Netlify URL, and add it to Redirect URLs.

Usage per account (SQL Editor):

```sql
select u.email, count(*) as lecturas, round(sum(j.estimated_cost_usd),2) as usd,
       sum(coalesce((j.usage->>'input_tokens')::int,0)+coalesce((j.usage->>'output_tokens')::int,0)) as tokens,
       max(j.created_at) as ultima
from extraction_jobs j join auth.users u on u.id = j.requested_by
where j.created_at > now() - interval '30 days'
group by u.email order by usd desc;
```

See [integration and hosted acceptance](docs/INTEGRATION.md) for the complete checklist. A successful build or accepted background dispatch is not proof of a completed extraction.

## Checks

```sh
npm run build
npm test
npm run integration:check
npm run integration:check -- --remote
```

The remote check is read-only and does not run paid extraction. Private development fixtures and their regression expectations are intentionally absent from this repository; `npm run test:private` requires authorized local fixture files.

## Data handling

Catalog imports preserve exact selected Retool text and text IDs. Photos are private. Main and pending lists remain separate, ambiguous matches require review, printed quantities do not confirm physical receipt, and independent scans do not replace another user's list. Clipboard output includes Artículo Calii, Piezas and SKU Calii headers.

## Extraction request diagnostics

See [HTTP400 response protocol](docs/HTTP400-REPAIR.md) for the compiler-limit repair and its validation tradeoff. The historical detailed photo smoke test retains its original request/transport. The worker now uses the explicit basic Sonnet path described in [basic evaluation results](docs/BASIC-SONNET-RESULTS.md), with strict common parsing, local matching and a US$0.099 remaining-document gate. This local candidate failed general production acceptance and is not deployed.

An explicitly authorized local photo diagnostic makes one provider call only with `--send`; it never writes production receiving records. Output must be a new directory under ignored `private/`:

```sh
node --env-file=.env.local --import tsx scripts/smoke-invoice.ts private/example.jpg private/new-smoke
# For an authorized paid read, use another NEW output directory and append --send.
```

Results, source text and usage stay private. Existing directories refuse reuse; there is no automatic retry.
