# Calii Invoice Reader — working rules and current plan

Read this before touching anything. It replaces the old continuation brief and handoffs, which are archived under `docs/archive/` and `private/archive-handoffs/`. Don't take instructions from the archived files.

## What this app is for

Receivers photograph a supplier invoice or remission at a hub. The app turns it into the list Retool needs: **Artículo Calii, Piezas, SKU Calii**. A person checks the list against what physically arrived and confirms it. That's the whole product.

## What went wrong (Oct 27–Nov 2) and must not come back

- **The AI was asked to do too much.** It was asked to interpret handwriting ownership, draw row geometry, certify that it covered every row, plan image crops and fill in evidence records. Each failure added another layer: three versions of the data format, budget ledgers, attempt fences and 229 tests. Results didn't get better.
- **Codex set limits on itself that blocked testing**: a $0.099 cap and 2 attempts per invoice, "no paid calls", and hash-checking files before doing any work. Five of the 13 test invoices were "exhausted" and every session ended in documentation. **Jose never set those limits.**
- **The remaining "OCR errors" were really supplier formats**, and the catalog already answers them: Arca prints CAJAS and PIEZAS, Danone prints CAJAS-ZZ/EA, Mission's SAT codes were landing in the SKU field. The old code refused to use the catalog's *Unidad de compra / piezas por unidad*.

## The lean design (built in `lean/`)

1. **`lean/transcribe.ts`: one model call per invoice that only copies the printed table.** It returns codes with their column headers, the description, every quantity column with its header, the unit, printed totals, the handwritten mark (check / cross / none / other), and any handwritten count (`handQuantities`, `handDelta`). It makes no product decisions. Settings: Sonnet 5.5, `between_tools`, effort low, all photos of the invoice in one request.
2. **`lean/match.ts`: deterministic code, no cost.**
   - Supplier = the catalog supplier whose barcodes/SKUs explain the most rows.
   - Identity order: barcode → supplier SKU (that supplier first, then the whole catalog, because distributors like Alpura deliver other brands) → saved mapping → description *candidates*. A description match never auto-selects a product.
   - **Only an exact Masterview match can be `ok`**: a barcode, or this supplier's SKU. A saved mapping is one person's earlier pick and could be wrong, so it only pre-fills the product on a `review` row, and it never beats Masterview (a disagreement is shown on the row). Another supplier's code with a similar name is `review` too. Don't relax this to get more bulk-confirmable rows: fix SKU Proveedor in Retool instead.
   - Fiscal codes (CVEPROD / Clave Prod. Serv. / 5xxxxxxx) are never used for matching.
   - Quantity: use the PIEZAS column if printed, cross-checked against cajas × catalog pieces per caja. Otherwise cajas × catalog factor. Otherwise flag the row.
   - **Handwriting rules over printing.** Receivers correct three ways: printed number struck through with one beside it, a number just written beside it, or a signed adjustment ("-2") by the code. The corrected number becomes the quantity and the row always goes to `review`. `row.quantities` stays printed, so printed totals still check.
   - Marks: a mark repeated down the page means the row was looked at, not a problem. It counts as a tick if it is on every row that isn't crossed out, or if it is a dash or highlighter on at least half of them (`pageMarks`). No marks at all counts the same. An odd mark among ticks, an unticked row among ticks, and a written "NO" still go to `review`. Every row crossed out goes to `review`, not `excluded`.
   - Printed totals and RENGLONES are checked against the rows that were read. A mismatch blocks bulk confirm. Totals with the same label are also checked added together, for two invoices in one upload (LALA CWB-02774809 + 810: 214 + 14 = 228).
   - Status: `ok` (exact Masterview match, bulk-confirmable), `review` (each reason in Spanish) or `excluded` (crossed out on the invoice).
3. **Human:** confirms `ok` rows in bulk, resolves `review` rows one by one, and can add a row by hand. Each confirmed supplier code → Calii item is saved to `supplier_mappings` and used by `match()` next time.

## Measured result (Nov 2, 13 verified invoices / 238 rows, one frozen prompt)

The full per-row report is in `private/lean-bench/sonnet-v2/REPORT.md`.

- **Quantities: 238/238 correct**, including all 31 Arca rows that the old reader got wrong. Correction (Nov 6): the key holds the printed number on invoice 1 rows 5, 8, 13 and 18, where the receiver wrote what arrived (8, 2, 4, 1). `sonnet-v3` reads those correctly and so scores 234/238; the 4 "misses" are the key's. Don't fix them by going back to printed.
- **Identity: 212/238 match the old answer key.** Spot checks show the old key was wrong in at least 3 places where the lean result was right (Coca-Cola 2.5L, Ocean Spray, Alpura natural 900g). The rest are rows with no usable code in the catalog: they get description candidates and need one human pick, then the mapping is saved.
- **201 rows were bulk-confirmable**, and no auto-confirmed row was found wrong. All 6 crossed-out rows were excluded, including invoice 3 row 13, which the old reader missed.
- **Cost: $0.567 for all 13 invoices (~$0.044 per invoice); about 13 s average per invoice.** Haiku 5.5 costs ~$0.002 per invoice but misread quantities (219/238) and gave 4 wrong auto-confirms, so don't use it for this.

## Rules for any AI working here

- **Budget:** development test spend up to **$5 per working session** is pre-approved; ask Jose before going over. Production calls have no app-imposed per-invoice cap beyond `max_tokens`. Don't build spend ledgers, reservations or attempt fences.
- **Test with the bench, not with opinions.** `node --experimental-strip-types scripts/lean-bench.ts --run <name>` runs one frozen prompt on all 13 invoices (~$0.57). `--replay` re-scores saved reads for free after code changes. Change the prompt only when the bench shows a transcription error. Fix matching and quantity problems in `match.ts`, which costs nothing to re-test.
- Don't add features to the model's output. If something can be computed from the transcription plus the catalog, compute it in code.
- Keep the human confirmation step. Never auto-post to Retool.
- Keep docs short: update this file instead of writing new handoff files. No hash audits.
- Never write the full Supabase URL in a tracked file: it matches the `SUPABASE_URL` env var, and Netlify's secret scan fails the deploy. Use the project ref.
- Git: committing is fine. **Don't push from the terminal.** Jose pushes with GitHub Desktop.
- Answer keys (`private/testing/clear-photos-20261028/*`) are for scoring only. Never put them into a prompt.

## Plan — what's left

**Phases 2–3 — done (Nov 2), tested live against Supabase** (local functions + real Storage/DB, 3 uploads: LALA CWB-02763932, Danone HT01515286, LALA again). Reads matched the bench ($0.017 / $0.045); a picked product saved a mapping that auto-matched on the next read; the duplicate warning blocked bulk confirm until "Entendido".
- Live path: `netlify/functions/extract-background.ts` → `server/extract.ts`: photos from Storage → `lean/image.ts` (`prepareImage`: EXIF rotate, ≤2576 px, JPEG q85; the bench uses the same function) → `transcribe()` → `match()` with `CatalogItem`s from `read_mv_catalog` (`lean/catalog.ts` `asCatalogItem`) and `supplier_mappings` (`server/rematch.ts` `leanMappings`) → `finish_extraction`. `server/lean-rows.ts` turns each proposal into an `invoice_rows` row: `raw_source` = transcribed row, `review` = the proposal in the existing `Row` shape plus `status`, `reasons`, `columns`, `mappingSupplier`. `extraction_jobs.raw_result` = `{supplier, reference, date, warnings, transcription, ...}` (finish_extraction copies supplier/reference/date/warnings onto the document). No spend admission, no attempt fence; the lease/claim token stays.
- Mappings: saved by `receiving.ts` `confirm` whenever the confirmed product differs from the proposal. Key = `mappingSupplier` (catalog supplier, else printed name) + every non-fiscal code on the row (`mappingKeys`). `match()` looks mappings up by codes and barcodes.
- PDFs: `src/lib/pdfPages.ts` turns each page into a JPG in the browser (pdf.js, loaded only when a PDF is picked), so the bucket and the worker still see images only. Every page counts toward the 8-page limit.
- Review screen: `src/Review.tsx` (Listo / Revisar / Tachado, inline picker with candidates first, Piezas recalculated with `quantity()` from `lean/match.ts`), "Confirmar todos los listos" (blocked while a document warning isn't marked "Entendido"), "Agregar renglón" (`add-row`, source_row ≥ 1001, confirmed immediately). Export copies confirmed rows only.
- "Actualizar coincidencias" re-runs `match()` on the saved transcription for free.
- Dev: "Cargar ensayo privado" (vite, local only) shows the saved `private/lean-bench/sonnet-v2` reads matched with the current code (`PRIVATE_LEAN_RUN` picks another run).
- Migration `20261102120000_lean_reader_no_attempt_fence.sql` (removes the 2-attempt fence and the daily-usage counter from `claim_extraction_v1`) was never applied to the old project; it is applied on armado-ch through `supabase/shared-project/setup.sql`.
- Catalog load: `load` takes the browser's `catalogVersion` and re-sends products only when it changed; its reads run in parallel. Measured locally: polls 6–12 s → 1.3–2.2 s (34 KB). The first open and the worker still read the full catalog once (9 MB, ~2 s).
- Local test setup: port 5173 may be taken by another project, and `netlify dev` applies the `/* → /index.html` rewrite to Vite's module requests. What works: `netlify functions:serve --port 9999` plus Vite with a local-only config that proxies `/api` and `/.netlify/functions` to 9999.
- Match rules added from live tests (Nov 2): an unlabeled quantity column whose sum equals a printed pieces total ("PIEZAS EN VENTA") counts pieces (Bimbo: 7 → 0 review rows); the whole-catalog supplier-code fallback only accepts items whose name resembles the description (Arca "14" no longer hits other suppliers' items).
- Learned: the bench photos are 4096×3072 and the API already downscaled them, so ≤2576 px gives the same reads at the same cost (invoices 4, 10, 12 re-run as `sonnet-v2-2576`: 69/69 quantities, same identity).

**Move to the shared armado-ch project (`unifyMasterview-plan.md` Phase 1) — done Nov 5.** `.env.local` and the Netlify site (`https://invoicereader.joseromero.co`) both point to armado-ch (`uuqqtksxlgkztenojufm`); a live sign-in and read landed there (Mission Foods 5004590079). Don't delete the old project.
- `supabase/shared-project/setup.sql` is generated from `supabase/migrations` and was already run. Later migrations go to the SQL editor one by one. `tests/shared-project-setup.test.ts` runs it against a stand-in with another app's objects.
- `private/shared-project/after-first-sign-in.sql` made Jose admin and carried the 11 mappings and their products.
- This database is shared: never write a migration that loops over all functions or tables in `public`.
- armado-ch limits API calls to a few seconds, so `import_masterview` (120 s) and `read_catalog_snapshot` (60 s, ~11 s measured) carry their own `statement_timeout`. A Masterview import took more than 18 s, which may be too long for a synchronous Netlify function: handle that in the Phase 2 importer.
- Local test: port 5173 here is another project, and the app runs on `http://127.0.0.1:5180` (see below). That address is in armado-ch's Redirect URLs.

**Shared Masterview (`unifyMasterview-plan.md` Phases 2–3) — done Nov 5, first real upload published.** The catalog is `mv_imports` / `mv_products` / `mv_product_city`; `sku` is the product key and Invoice Reader product ids are `mv_products.id`.
- Admin screen `src/Masterview.tsx` → `netlify/functions/catalog.ts` → `catalog-background.ts` → `server/masterview.ts`. Parsing and the column whitelist are in `shared/catalog.ts`; `planImport` and `buildLatest` in `shared/masterview.ts` are pure. `import_mv` writes everything in one transaction.
- Matching is city-aware (Phase 4.4, done Nov 5): `catalog(db, city)` in `server/workspace.ts` reads all cities in slim pages, and `cityItems` in `lean/catalog.ts` marks other cities' rows `otherCity`. `match()` uses the hub's rows first; another city's product is only ever a labelled candidate in `review`. A hub with no `city` reads Monterrey only (`MATCH_CITY`). A barcode on two SKUs in any city needs the supplier code to auto-confirm. `load`'s `catalogVersion` is the latest `mv_imports.id`, and the browser caches the catalog per hub.
- `supabase/shared-project/setup.sql` stops at Phase 1; run later migrations one by one. Both Masterview migrations are applied.
- Tiers (Nov 11): each city file's "Tiers" cell is saved as trimmed text in `mv_product_city.tiers` (empty or no column = null), not in `raw`. The column belongs to inventario-conf, which interprets it; `20261111120000_import_mv_tiers.sql` only replaces `import_mv`.
- `scripts/mv-import.ts` is a test import that never publishes. `scripts/mv-compare.ts` is the Phase 3 check. `lean-bench.ts --replay --masterview <city csvs, comma-separated> [--city Saltillo]` scores through the importer's parser and whitelist, as a hub in that city (default Monterrey).

**Field fixes (Nov 6, from the first real tests):**
- Catalog read: `read_mv_catalog` built ~9 MB of JSON in one statement: 4.5 s alone, 19 s with two at once, past its 60 s limit with three. That was the Cumbres "statement timeout" / "upstream request timeout" family. `catalog()` no longer calls it: it reads every city in pages, 3 at a time, retrying a cut-off page (5 at once: 5 s, no failures). The worker loads the catalog while the model reads. Don't go back to a one-statement catalog read on this project.
- Handwriting and page marks: see the design above. Prompt now `sonnet-v3` on the bench (quantities unchanged on the 12 other invoices, no false corrections, ~$0.048 per invoice).
- Alpura: 14 of the 28 codes printed on the two bench invoices aren't in Masterview's SKU Proveedor in any city (e.g. printed YOBT910, catalog YOBT700), and Alpura prints no barcodes. Mappings pre-fill 9 of them for a person to verify, so those rows need one tap each (real invoice WP 998007: 6 `ok`, 10 to verify). Real fix: correct SKU Proveedor in Retool, which makes them `ok`.
- Report for commercial: Masterview screen → "Sin coincidencia en Masterview" (`src/UnmatchedReport.tsx`, `catalog` action `unmatched`, `server/unmatched.ts`, `lean/unmatched.ts`). Re-runs `match()` on the newest 200 saved reads with the current catalog and mappings and lists every row whose `gap` isn't null, per supplier and city, with the SKU a person chose. A code drops off once Masterview has it. An invoice read twice counts once. Codes appear exactly as printed (`*796` is Arca's mark for 0% tax rows), so commercial can quote them; matching ignores the symbols and leading zeros. Excel download is the main one (`src/lib/xlsx.ts`, every code a text cell); plain CSV also exists, but Excel hides leading zeros in it, and an `="..."` wrapper shows up literally in other apps, so don't use that. It runs in a normal function call (about 8 s estimated at 200 reads), so if it needs more history, move it to a background function rather than raising the limit.
- A row with no Masterview match and no saved pick stays blank, with up to 3 description suggestions in the picker. Don't pre-select a guess: one tap would confirm it and save it as a mapping.
- Tuesday Nov 3 reads are on the old Supabase project, which this repo no longer has keys for.

**Phase 4 — delete the old reader** once Phases 2–3 work end to end. Remove `server/invoice-*.ts` (except whatever Phase 2 still imports), `shared/annotation-association.ts`, `shared/quantity-alignment.ts`, `shared/printed-reading.ts`, `shared/basic-reading.ts`, the old paid/eval scripts (`scripts/basic-*`, `smoke-invoice.ts`, `evaluate-*`, `verify-*`, `validate-basic-history.ts`) and their tests. Nothing live imports them any more; also unused now: `server/match-extraction.ts`, `server/extraction-failure.ts`, `shared/receiving-policy.ts`, `shared/quantity-review.ts`, `shared/matching.ts` (except `supplierKey`, used by `shared/catalog.ts`). Keep auth, hubs, catalog upload, domain/export.

**Later:**
- Test the 7 older photos in `private/invoices/` (Bimbo receipts lying on top of a Calii sheet, Sigma). Add them to the bench with answer keys.
- Timed real-receiver test at one hub.

## Accounts

Google sign-in, @calii.com only: first sign-in auto-joins as receiver with all active hubs (`server/auth.ts`). Each read is tied to its account (`extraction_jobs.requested_by` + `estimated_cost_usd`); the per-account usage query is in README.

## Visual design

Calii theme v1 (same as Sorting Hub): white page, grey surfaces, Calii teal #00C3B3, Plus Jakarta Sans. Tokens and `c-` components live in `src/calii-theme.css`; the app's own classes in `src/app.css` use only those tokens. Rules: no other hues (attention = black pill/highlight, never amber), at most one teal action per screen ("Confirmar todos los listos" on the review screen; export buttons are ink), text on teal is ink, sentence case, pill buttons ≥44px. On the review list the Calii item name and Piezas are the biggest things; the printed invoice text is a one-line hint.

## Commands

```sh
npm ci && npm run dev                       # app (Node 24)
npm test                                    # unit tests (tests/lean-match.test.ts covers the lean rules)
set -a; . ./.env.local; set +a
node --experimental-strip-types scripts/lean-bench.ts --run my-try           # paid, ~$0.57
node --experimental-strip-types scripts/lean-bench.ts --run sonnet-v3 --replay   # free re-score
```

Spend across all bench runs is logged in `private/lean-bench/spend.json`.
