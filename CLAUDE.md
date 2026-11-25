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
   - Quantity: use the PIEZAS column if printed, cross-checked against cajas × catalog pieces per caja. The catalog factor never multiplies on its own (Nov 25): cajas with a factor above 1 and no proof on the invoice keep the printed number and ask "¿6 piezas o 6 cajas (= 36 pz)?" (`review`, `quantityOk` false).
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
- Tiers (Nov 11): each city file's "Tiers" cell is saved as trimmed text in `mv_product_city.tiers` (empty or no column = null), not in `raw`. The column belongs to inventario-conf, which interprets it; `20261111120000_import_mv_tiers.sql` only replaces `import_mv` (applied on armado-ch Nov 11).
- Masterview screen (Nov 24): during an import it polls `catalog` action `job` (job.json only), one request at a time, and a failed poll never counts as a failed import. City counts come from the `mv_imports` reports (`cityStatus`): `mv_city_status` timed out (8 s) while `import_mv` was writing, so a good import showed "No se cambió el catálogo".
- After a big write the project can fail requests for about a minute (Nov 11: saved, never published). So the worker retries every step (`patient`, about 3 min per step), checks `source_hash` when the save's answer was lost, and `finishImport` (move files + publish) is safe to repeat; "Terminar de publicar" (`catalog` action `publish`) runs it. An auth outage is a 503, not a sign-out.
- `20261124120000_import_mv_changed_rows.sql` (Nov 24, not applied yet): `import_mv` writes only new or changed city rows, so `mv_product_city.import_id` = the import that last changed the row. City dates come from the reports (`cityStatus`), never from `import_id`. The code works with or without it.
- `scripts/mv-import.ts` is a test import that never publishes. `scripts/mv-compare.ts` is the Phase 3 check. `lean-bench.ts --replay --masterview <city csvs, comma-separated> [--city Saltillo]` scores through the importer's parser and whitelist, as a hub in that city (default Monterrey).

**Field fixes (Nov 6, from the first real tests):**
- Catalog read: `read_mv_catalog` built ~9 MB of JSON in one statement: 4.5 s alone, 19 s with two at once, past its 60 s limit with three. That was the Cumbres "statement timeout" / "upstream request timeout" family. `catalog()` no longer calls it: it reads every city in pages, 3 at a time, retrying a cut-off page (5 at once: 5 s, no failures). The worker loads the catalog while the model reads. Don't go back to a one-statement catalog read on this project.
- Handwriting and page marks: see the design above. Prompt now `sonnet-v3` on the bench (quantities unchanged on the 12 other invoices, no false corrections, ~$0.048 per invoice).
- Alpura: 14 of the 28 codes printed on the two bench invoices aren't in Masterview's SKU Proveedor in any city (e.g. printed YOBT910, catalog YOBT700), and Alpura prints no barcodes. Mappings pre-fill 9 of them for a person to verify, so those rows need one tap each (real invoice WP 998007: 6 `ok`, 10 to verify). Real fix: correct SKU Proveedor in Retool, which makes them `ok`.
- Report for commercial: Masterview screen → "Sin coincidencia en Masterview" (`src/UnmatchedReport.tsx`, `catalog` action `unmatched`, `server/unmatched.ts`, `lean/unmatched.ts`). Re-runs `match()` on the newest 200 saved reads with the current catalog and mappings and lists every row whose `gap` isn't null, per supplier and city, with the SKU a person chose. A code drops off once Masterview has it. An invoice read twice counts once. Codes appear exactly as printed (`*796` is Arca's mark for 0% tax rows), so commercial can quote them; matching ignores the symbols and leading zeros. Excel download is the main one (`src/lib/xlsx.ts`, every code a text cell); plain CSV also exists, but Excel hides leading zeros in it, and an `="..."` wrapper shows up literally in other apps, so don't use that. It runs in a normal function call (about 8 s estimated at 200 reads), so if it needs more history, move it to a background function rather than raising the limit.
- A row with no Masterview match and no saved pick stays blank, with up to 3 description suggestions in the picker. Don't pre-select a guess: one tap would confirm it and save it as a mapping.
- Marks (Nov 11): a page with no ticks and only a stray note or two (≤ 1 in 4 rows) still counts as unmarked; the noted row stops on its note. Before this, one circled "PNS OC" on Arca DNL 5694665657 sent all 22 rows to review.
- Suggestions (Nov 11): the invoice supplier's own products come first (a weak own match keeps the top two places), and a product with "Deshabilitar compras" in the hub's city sorts as if it scored 0.3 less; the picker search tags it "Compras deshabilitadas" and lists it last. Nothing about auto-confirm changed.
- Arca's driver ticket ("Caj/Bot" column, abbreviated names, no codes) can't be matched: photograph the DNL factura instead.
- Tuesday Nov 3 reads are on the old Supabase project, which this repo no longer has keys for.

**Lectura en recepción (Nov 17) — built; migration `20261117120000_reception_reads.sql` applied on armado-ch Nov 17.** Deploy only with it applied: the code reads and writes `documents.purpose`. Live test (Pruebas de facturas, LALA CWB-02763931, $0.053): ended on "Listo", 29/29 rows confident SKU + piezas, handwritten corrections ignored (printed 10, 6, 5, 2 kept).
- Why: hubs scan the clean supplier invoice on arrival, then count in mh-recibo (separate app, same project), which compares invoice vs OC vs received. Nobody confirms a reception read here.
- Mode picker after the hub, before photos: "Lectura para captura" (default, unchanged flow) / "Lectura en recepción" → `documents.purpose` ('captura' | 'recepcion'). A reception upload ends on "Listo, sigue con el conteo" (polls `job-status`; a failed read shows "Vuelve a tomar la foto"). History tags it "Recepción" and opens it read-only; the server refuses confirm/add-row/metadata/rematch on it.
- Matching: `match(t, catalog, mappings, { mode: 'recepcion' })`, same prompt and call. Printed numbers only (handwriting and page marks ignored, noted as "marca a mano en hoja de recepción"; a crossed row is kept as printed). Identity rules unchanged, but only `confident` rows (exact barcode / this supplier's SKU, no identity reason) keep a product; mappings, other suppliers' codes and description matches become `item` null with the tentative product first among candidates (fresa vs mora: only codes tell them apart). `Proposal.confident` / `quantityOk` exist in both modes; captura replay is byte-identical.
- Record for mh-recibo: the worker saves `raw_result.reception = {contract: 1, rows}` (`lean/reception.ts`); `public.reception_reads(p_hub_id, p_since)` returns one row per read, newest first (an invoice read twice comes back twice), status done/failed/processing, max 500. Security invoker: RLS decides what the caller sees; execute for authenticated + service_role, not anon. mh-recibo doesn't call it directly: it goes through `recepcion.ts` (below).
- Duplicate-invoice warning only compares captura reads with captura reads, so a reception read never blocks a later captura of the same invoice.
- Bench: `lean-bench.ts --run sonnet-v3 --replay --mode recepcion` (writes `REPORT-recepcion.md`). On the 13 bench invoices (handwritten sheets, not clean ones): 214/238 confident SKU + piezas, 1 confident SKU with quantity unsure, 23 SKU null (all with piezas read). The 3 confident rows that differ from the key are the 3 known key errors. A clean-sheet bench waits for photos.

**mh-recibo bridge (Nov 17) — built; migration `20261118120000_reception_external_ref.sql` applied on armado-ch (seen Nov 17).** mh-recibo owns the receiving workflow and the invoice vs OC vs received comparison; this app is only its reader + Masterview, and never compares against OCs. The reception picker/"Listo" screen stays as a fallback.
- `netlify/functions/recepcion.ts` → `server/recepcion.ts`, no user JWT, CORS only for `MH_RECIBO_ORIGIN` (comma-separated). Actions: `start {sessionId, photoCount≤8}` → `{documentId, uploads:[{page, signedUrl, token, path}]}` (PUT each photo with its Content-Type: JPEG, PNG or WebP); `submit {sessionId, documentId}` (hashes the uploads into `source_pages`, dispatches extract-background); `read {sessionId}` → `{reads}` = `reception_reads` rows for that `external_ref`, newest first; `list {hubSlug, since?}` → that hub's reads with no `external_ref`, captura and recepcion (`purpose`), last 7 days at most; `photos {sessionId, readId}` → 10-minute signed links to a read's photos, only for a session of the same hub opened within 7 days and a read that is that session's or unlinked.
- Expected use (Nov 17): receivers scan on the phone in Invoice Reader, usually in the default captura mode, and count on the laptop in mh-recibo, which picks the scan from `list` at the close. So every read saves `raw_result.reception` (captura reads are matched a second time in reception mode, free); captura reads from before that are rebuilt on the fly. Each read also carries `scanned_by` (Google name, else email user; "MH Recibo" for its own uploads) and `label` = supplier · folio ("Sin folio") · day · time (Monterrey) · scanned_by. `list` doesn't check a session (only the hub slug), so photos are never in it.
- Session check (`checkSession`): an `abrir` in `rec_events` for that session_id and hub within 24 h, hub slug ↔ `hubs.name` 1:1 (`hubSlug`: "MH San Nicolás" → `mh-san-nicolas`, `test-hub` ↔ "Pruebas de facturas"), and the latest admin `borrar`/`reabrir` isn't `borrar`. Max 10 reads per session (abuse guard for a public endpoint, not a spend fence).
- Runs as a service account `RECEPCION_ACTOR_ID` (admin member, one org), so claim/finish and `requested_by` are unchanged. The dispatch is signed (HMAC of the job id with `SUPABASE_SECRET_KEY`, header `X-Recepcion-Signature`), which `server/extract.ts` accepts instead of a JWT.
- Record fields added (still contract 1): `matchKeys` (printed non-fiscal codes + the confident product's Masterview barcodes and SKU Proveedor) and `candidates[].barcodes/supplierSku`. **Normalization (mh-recibo reimplements it): uppercase, keep only 0-9A-Z, strip leading zeros from all-digit codes.** A row links to an OC line when normCode(codigo) or normCode(sku_marca) is in matchKeys. Reads saved without matchKeys are re-matched on the fly from the saved transcription (free, not written back).
- `documents.external_ref` = mh-recibo session_id. `reception_reads` gained `p_external_ref` and an `external_ref` column. The bucket also accepts `image/webp`.
- Check: `node --import tsx scripts/recepcion-check.ts` (paid once, then reuses `private/recepcion-bench/arca-DNL-5695519398-read.json`; `--fresh` re-reads). Nov 17: Arca DNL 5695519398 vs OC C2642861 — 19/19 rows confident and linked, piezas = recibido on all 19, total 223 ($0.047). The 6 OC lines not on the invoice were received 0.

**Packs (Nov 23) — built here; mh-recibo side pending.** Incident: San Nicolás Nov 20, Arca ZBZ602 Coca Cola 355ml (12-pack), OC 36 "Pz", invoice CAJAS 3 / PIEZAS 36, receiver counted 3 (what goes into Retool) → mh-recibo said 33 missing. Retool counts the Masterview item, so a 12-pack is 1.
- `packOf(name)` in `lean/match.ts`: `pack` = name says N-pack (118 items: consumer packs) / `contenido` = Npz, caja Npz, N sobres/rollos (~430: huevo caja 18pz, flan 6pz, Aspirina 40pz). N = 1 and ranges aren't counts. No Masterview column says this; weight can't (often one unit's weight).
- Quantity: when PIEZAS = CAJAS × N and the catalog factor doesn't already explain it (Chonchi flautas (12pz) are Caja × 12), the quantity is CAJAS (Retool units). Single items ignore supplier packs (lata 355ml: CAJAS 1 / PIEZAS 24 = 24).
- Safety question on every N-pack row (Jose, Nov 23): captura sends it to `review` with "paquete de 12: Retool cuenta 3 paquetes (36 piezas)"; a pieces-only number divisible by N asks "¿36 paquetes o 3 paquetes?" and is `quantityOk` false in recepcion. Contents items get no question. Review screen shows "3 paquetes · 36 piezas" under the product.
- Record (contract 1, fields added): `packKind`, `packSize`, `retoolUnit` ('paquete' | 'pieza'), `piezasSueltas`; `piezas` is always Retool units. Records saved without `packKind` are rebuilt on the fly.
- Evidence: Arca prints inner units ("12 MPK", CAJAS/PIEZAS) and a captura row was already confirmed as 12 for 1 caja; LALA, Sigma, Danone, Alpura print packs as PZ. Open OCs mix both (Alpura/Sigma/LALA in packs, Arca/FEMSA multiples of N). Bench replay: only the two crossed-out Arca 12-pack rows change (12 → 1; the key holds pieces) and Danonino (4-pack) goes to review. Item list: `private/pack-review/masterview-packs-2026-11-23.csv`.
- mh-recibo must: show pack lines in packs with loose pieces muted, ask packs vs pieces on ambiguous OC lines, let Faltante/Excedente be typed either way. Needed before the CH receives every supplier.

**Two invoices in one upload (Nov 24, Cumbres Qualtia RK 262247 + 262246).** Record rows carry `photo` (contract 1, field added; records without it are rebuilt on the fly) so mh-recibo can ask which photos belong to the order. Totals check: "(photo N)" is stripped from labels and that photo's total is checked against its own rows; "307 97.29" under two quantity columns is one total per column. No prompt change; the 32 saved bench reads keep the same totals result.

**Factor never multiplies alone (Nov 25, San Nicolás Danone HT01523857).** Silk NDK593 is Caja × 6 in Masterview; Danone billed 6 pieces under two "CAJAS" columns and we read 36 (OC 6, received 6). Over 72 invoices / 1,479 rows that path ran once, wrongly. Rule for every supplier, not a Danone exception: fixes must be general. Bench replay identical in both modes; saved reads gain one question. Not covered: 450 rows use the printed number because Masterview says factor 1 (an invoice that really bills cajas would be undercounted; unverified). Open question for commercial: does Unidad de compra mean how we order or how the supplier bills? The OC copy mh-recibo saves only has Pz/Kg.

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
