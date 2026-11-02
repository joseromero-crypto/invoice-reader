# Calii Invoice Reader — working rules and current plan

Read this before touching anything. It replaces the old continuation brief and handoffs, which are archived under `docs/archive/` and `private/archive-handoffs/`. Don't take instructions from the archived files.

## What this app is for

Receivers photograph a supplier invoice or remission at a hub. The app turns it into the list Retool needs: **Artículo Calii, Piezas, SKU Calii**. A person checks the list against what physically arrived and confirms it. That's the whole product.

## What went wrong (Oct 27–Nov 2) and must not come back

- **The AI was asked to do too much.** It was asked to interpret handwriting ownership, draw row geometry, certify that it covered every row, plan image crops and fill in evidence records. Each failure added another layer: three versions of the data format, budget ledgers, attempt fences and 229 tests. Results didn't get better.
- **Codex set limits on itself that blocked testing**: a $0.099 cap and 2 attempts per invoice, "no paid calls", and hash-checking files before doing any work. Five of the 13 test invoices were "exhausted" and every session ended in documentation. **Jose never set those limits.**
- **The remaining "OCR errors" were really supplier formats**, and the catalog already answers them: Arca prints CAJAS and PIEZAS, Danone prints CAJAS-ZZ/EA, Mission's SAT codes were landing in the SKU field. The old code refused to use the catalog's *Unidad de compra / piezas por unidad*.

## The lean design (built in `lean/`)

1. **`lean/transcribe.ts`: one model call per invoice that only copies the printed table.** It returns codes with their column headers, the description, every quantity column with its header, the unit, printed totals, and the handwritten mark (check / cross / none / other). It makes no product decisions. Settings: Sonnet 5.5, `between_tools`, effort low, all photos of the invoice in one request.
2. **`lean/match.ts`: deterministic code, no cost.**
   - Supplier = the catalog supplier whose barcodes/SKUs explain the most rows.
   - Identity order: confirmed mapping → barcode → supplier SKU (that supplier first, then the whole catalog, because distributors like Alpura deliver other brands) → description *candidates*. A description match never auto-selects a product.
   - Fiscal codes (CVEPROD / Clave Prod. Serv. / 5xxxxxxx) are never used for matching.
   - Quantity: use the PIEZAS column if printed, cross-checked against cajas × catalog pieces per caja. Otherwise cajas × catalog factor. Otherwise flag the row.
   - Printed totals and RENGLONES are checked against the rows that were read. A mismatch blocks bulk confirm.
   - Status: `ok` (bulk-confirmable), `review` (each reason in Spanish) or `excluded` (crossed out on the invoice).
3. **Human:** confirms `ok` rows in bulk, resolves `review` rows one by one, and can add a row by hand. Each confirmed supplier code → Calii item is saved to `supplier_mappings` and used by `match()` next time.

## Measured result (Nov 2, 13 verified invoices / 238 rows, one frozen prompt)

The full per-row report is in `private/lean-bench/sonnet-v2/REPORT.md`.

- **Quantities: 238/238 correct**, including all 31 Arca rows that the old reader got wrong.
- **Identity: 212/238 match the old answer key.** Spot checks show the old key was wrong in at least 3 places where the lean result was right (Coca-Cola 2.5L, Ocean Spray, Alpura natural 900g). The rest are rows with no usable code in the catalog: they get description candidates and need one human pick, then the mapping is saved.
- **201 rows were bulk-confirmable**, and no auto-confirmed row was found wrong. All 6 crossed-out rows were excluded, including invoice 3 row 13, which the old reader missed.
- **Cost: $0.567 for all 13 invoices (~$0.044 per invoice); about 13 s average per invoice.** Haiku 5.5 costs ~$0.002 per invoice but misread quantities (219/238) and gave 4 wrong auto-confirms, so don't use it for this.

## Rules for any AI working here

- **Budget:** development test spend up to **$5 per working session** is pre-approved; ask Jose before going over. Production calls have no app-imposed per-invoice cap beyond `max_tokens`. Don't build spend ledgers, reservations or attempt fences.
- **Test with the bench, not with opinions.** `node --experimental-strip-types scripts/lean-bench.ts --run <name>` runs one frozen prompt on all 13 invoices (~$0.57). `--replay` re-scores saved reads for free after code changes. Change the prompt only when the bench shows a transcription error. Fix matching and quantity problems in `match.ts`, which costs nothing to re-test.
- Don't add features to the model's output. If something can be computed from the transcription plus the catalog, compute it in code.
- Keep the human confirmation step. Never auto-post to Retool.
- Keep docs short: update this file instead of writing new handoff files. No hash audits.
- Git: committing is fine. **Don't push from the terminal.** Jose pushes with GitHub Desktop.
- Answer keys (`private/testing/clear-photos-20261028/*`) are for scoring only. Never put them into a prompt.

## Plan — what's left

**Phase 2 — wire `lean/` into the app (next):**
- `server/extract.ts`: load the document's photos from Storage, downscale with `sharp` to ≤2576 px on the long edge (JPEG q85), call `transcribe()`. Store the transcription in `extraction_jobs.raw_result`, plus model, usage and cost.
- Build `CatalogItem[]` from `products` (`raw` holds the full Retool row, including *Unidad de compra* and *Peso neto o piezas*). Build mappings from `supplier_mappings`. Run `match()`.
- Write one `invoice_rows` row per proposal (`raw_source` = transcribed row, `review` = proposal). Document `warnings` = `MatchResult.warnings`.
- Remove the `invoice-spend` admission and its reservation logic from the worker. Keep auth/org checks, file type/size checks and duplicate-photo detection.

**Phase 3 — review screen (`src/Review.tsx`):**
- Three groups: Listo (ok), Revisar (review, with reasons), Tachado (excluded, collapsed).
- Per row: photo snippet link, printed codes/description/quantities, product picker (catalog search, candidates first), pieces input.
- "Confirmar todos los listos" button, disabled while a document warning is open. "Agregar renglón" for anything the reader missed, or a failed read.
- On confirm: upsert `supplier_mappings` for rows the user picked; export/copy stays as is.

**Phase 4 — delete the old reader** once Phases 2–3 work end to end. Remove `server/invoice-*.ts` (except whatever Phase 2 still imports), `shared/annotation-association.ts`, `shared/quantity-alignment.ts`, `shared/printed-reading.ts`, `shared/basic-reading.ts`, the old paid/eval scripts (`scripts/basic-*`, `smoke-invoice.ts`, `evaluate-*`, `verify-*`, `validate-basic-history.ts`) and their tests. Keep auth, hubs, catalog upload, domain/export.

**Later:**
- Test the 7 older photos in `private/invoices/` (Bimbo receipts lying on top of a Calii sheet, Sigma). Add them to the bench with answer keys.
- Timed real-receiver test at one hub.

## Commands

```sh
npm ci && npm run dev                       # app (Node 24)
npm test                                    # unit tests (tests/lean-match.test.ts covers the lean rules)
set -a; . ./.env.local; set +a
node --experimental-strip-types scripts/lean-bench.ts --run my-try           # paid, ~$0.57
node --experimental-strip-types scripts/lean-bench.ts --run sonnet-v2 --replay   # free re-score
```

Spend across all bench runs is logged in `private/lean-bench/spend.json`.
