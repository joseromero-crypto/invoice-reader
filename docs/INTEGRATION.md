# Supabase · Anthropic · Netlify acceptance

Keep the operator flow: hub → upload photos → review → copy/export to Retool. Setup belongs in platform settings, not in the operator interface.

## Safe configuration check

Copy `.env.example` into ignored `.env.local` and fill it locally. Never send server keys in chat or use a `VITE_` prefix for them.

```sh
npm run integration:check
npm run integration:check -- --remote
```

The first command validates configuration without network calls. `--remote` performs read-only schema, private bucket, Auth signup, company/hub, catalog snapshot and Anthropic model-access probes. If `SITE_URL` is set, it also checks that the deployed receiving API rejects unauthenticated requests. It does not apply migrations, change data, upload invoices or call paid Anthropic messages. Failures print check names, never credentials or service response bodies. Passing these probes is not hosted acceptance.

## Supabase project

Confirm the intended project before changing it. Apply migrations `001`, `002`, `003` in that order using the project's SQL editor or its linked CLI migration workflow. Review existing schema and migration history before applying; these are initial migrations, not safe to replay on an already migrated database.

Disable public signup. Create the company organization, invite the initial administrator via Supabase Auth and insert its `members` record with role `admin`. Invite receivers and assign both company membership and explicit `hub_members` records. Admins see all eight hubs. Use the membership SQL in README with the actual invited user and company UUIDs. No default password or public enrollment.

Verify the `invoices` and `catalogs` buckets are private and the migration policies are active. Configure Supabase Site URL and allowed Auth redirect URLs for the final Netlify domain. Add the local functions origin only for local development if needed. Migration tests use stub Auth/Storage schemas and do not replace these checks.

## Anthropic

Set `ANTHROPIC_API_KEY` and an explicitly chosen image/tool-capable `ANTHROPIC_MODEL` in local/server function settings. The remote check verifies model access without a messages call. Verify current model capabilities and pricing before selecting a model:

- https://platform.claude.com/docs/en/models/overview
- https://platform.claude.com/docs/en/build-with-claude/vision

Leave optional pricing variables blank until prices for that exact model are verified. Actual model, tokens and available usage are persisted after extraction. Start with the single Hygeia invoice; do not batch the full trial before checking its real results. The fixture's three main rows / nine pieces are comparison data, not an answer to force or a physical receiving confirmation.

## Netlify

Confirm the target site/team and GitHub target before a first push. Existing `netlify.toml` builds `dist`, bundles TypeScript functions, includes native `sharp` and uses Node 24. Configure:

| Variable | Scope |
| --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Build (public browser configuration) |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Functions |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Functions |
| Upload/page/daily limits and optional verified prices | Functions |

Never set `PRIVATE_FIXTURE_ROOT` on Netlify. Keep private catalogs/photos outside the source deployment. Redeploy after changing public build variables. Use platform secret settings for server credentials. Do not publish `.env.local`.

Plain `npm run dev` serves Vite only. Use official Netlify CLI `netlify dev` for the local authenticated API/background-function workflow; ensure all server variables are available to its functions runtime. Use the URL printed by Netlify Dev. Hosted background behavior still requires a deployed check.

Netlify background functions acknowledge dispatch with HTTP 202 before processing, can run for 15 minutes and may be retried by the platform. See https://docs.netlify.com/build/functions/background-functions/. Keep the `extract-background` suffix and durable database claim fencing; 202 does not prove Anthropic succeeded. Do not blindly retry an uncertain paid call.

## Hosted acceptance (requires actual accounts and credentials)

1. Run the read-only remote check against the confirmed deployment configuration.
2. Sign in as admin and as two assigned receivers. Verify unauthenticated and cross-hub database, Storage and function access is denied. Confirm a receiver cannot import a catalog.
3. Import the original Masterview through the main-page uploader. Open a second browser/account and verify exact names and IDs; test partial updates and stale version rejection without overwriting history.
4. Upload one Hygeia invoice and verify private photo loading, queued → processing → complete status, original printed date, extracted source rows, deterministic matching, pieces, persisted job model/usage and warnings. Investigate differences from the assisted trial.
5. Run independent scans at different hubs and two at one hub. Keep one older list open while a new scan starts. Refresh the auth token and verify the current list stays open. Verify stale edits are rejected.
6. Resolve a pending product individually; verify its exclusion before confirmation, partial-output acknowledgement, clipboard headers and CSV. Nothing here changes Retool inventory.

Record actual outcomes, deployment URL and limits; do not mark hosted acceptance complete based on local tests.

## Recheck a saved extraction without another model call

`Actualizar coincidencias` on a completed live invoice rebuilds untouched row matches from its stored extraction and the current catalog. It does not upload images, queue extraction, or consume Anthropic calls. Confirmed/edited rows remain intact, and revision checks preserve concurrent edits.

For local development with no server credentials, put a saved extraction JSON in the ignored private fixture root, then run:

```sh
PRIVATE_REPLAY_FILE=saved-extraction.json npm run dev -- --port 5174 --strictPort
```

Open the loopback URL, choose a hub and use `Cargar ensayo privado`. This is a labeled replay, not new OCR or a hosted persistence check. The filename must be inside the private root; do not put it in public assets or deploy this development server.

Receiving policy: work with uploaded pages only. Page counts, absent prices, totals, currency, background objects and image angle do not block the item/quantity list. PZ counts the selected catalog item, including multipacks. Clear row checkmarks confirm reception when product and quantity are unambiguous; identity conflicts, unreadable quantities and unverified conversions still require review. Original extracted source text and IDs remain separate from matching/receiving decisions.
