# Calii Invoice Reader

A small invoice-checking step before Retool: **select hub → upload invoice photos → review Calii items and pieces → copy or export**. Pending products stay separate until confirmed. This app does not update Retool inventory.

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

Apply all SQL files in `supabase/migrations` in filename order for a new database. Provision a company and invited users; administrator members see all eight hubs, receivers need explicit hub assignments. RLS protects shared history and private photo/catalog storage. Internal policy helpers live in an unexposed schema; mutations are server-only.

AI reads have no app-imposed daily call cap. Daily counters retain usage accounting; explicit retries, attempt limits and duplicate-job fencing remain enforced.

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

See [HTTP400 response protocol](docs/HTTP400-REPAIR.md) for the compiler-limit repair and its validation tradeoff. The worker and local photo smoke test share the same request/image preparation and strict response parser.

An explicitly authorized local photo diagnostic makes one provider call only with `--send`; it never writes production receiving records. Output must be a new directory under ignored `private/`:

```sh
node --env-file=.env.local --import tsx scripts/smoke-invoice.ts private/example.jpg private/new-smoke
# For an authorized paid read, use another NEW output directory and append --send.
```

Results, source text and usage stay private. Existing directories refuse reuse; there is no automatic retry.
