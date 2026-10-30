# HTTP400 request repair — 29 October 2026

Provider smoke passed for two original invoice photos using the production request builder: 20 extracted rows, all printed quantities checked, complete responses and strict validation. Final response protocol uses a small native JSON envelope; the complete source/evidence contract is validated server-side. Six full-contract simplifications were rejected, so the nullable-array experiment is superseded. Local checks: 153 tests/18 files, build/typecheck/private fixtures, 37-invoice/868-row replay and lossless envelope transport all pass. User manual push and hosted acceptance remain pending. Read docs/HTTP400-REPAIR.md and the private bug handoff for evidence/limits. Tasks 3–5 remain queued; this does not certify all OCR or billed-alignment behavior.

# October 29 fixes — Calii Invoice Reader

Date: October 29, 2026 (America/Monterrey).
Working application: `/Users/adrianrodriguez/Desktop/calii-invoice-reader`.

Work through one problem per task, in the order below. Start with Task 1. Keep other tasks queued; do not bundle them into the handwriting fix. Update each task with implementation, validation, limitations and the next action. Local implementation complete and verified live are separate milestones.

## Starting point

- Latest completed campaign: eight independent scans, 250 rows; overall acceptance FAIL.
- Printed quantity/item agreement: 243/250 (97.2%). This is not complete row accuracy.
- All 250 source lines appeared once in printed order; no background/fiscal extras observed.
- Local validation at the published campaign baseline: 99 tests, build/typecheck and private regressions passed.
- Last campaign-verified production commit: `dedc1de`; inspect actual Git/deployment state before later work rather than assuming it is still current.
- Matching guards, direct catalog counts, saved histories and sampled output behavior improved. Confidently misread or omitted visual evidence remains the main blocker.

Authoritative evidence is private: `private/testing/targeted-live-20261029/REPORT.md`, `row-review.json`, original photos, raw results and review records. Earlier reports remain historical evidence. The current opening section of `HANDOFF.md` supersedes older status sections.

## Task 1 — Associate handwriting with the correct item and prevent unsafe confirmation

Status: LOCAL ASSOCIATION SAFEGUARDS AND USER-APPROVED MANUAL QUANTITY WORKFLOW COMPLETE (29 October 2026). Fresh OCR/live acceptance remains NOT RUN and tracked separately. Local Task 1 work is ready to hand off; proceed to Task 2 in a new chat without repeating or discarding these changes.

### Problem

On Sigma12, a handwritten quantity correction belonging to one printed item was attached to its neighbor. The affected item was wrongly auto-confirmed; its neighbor received the wrong pending reason. Another handwritten sum was transcribed incorrectly, although contained as pending. Existing reception rules correctly block many reported conflicts, but cannot recover an annotation the reader omitted or confidently assigned to the wrong row.

### Desired behavior

- Associate each visible annotation with the supplier row it actually modifies, following the printed baseline on slanted tables.
- Preserve billed quantity separately from handwriting. Never silently substitute a received quantity.
- A conflicting quantity, cross, return, circle or ambiguous mark keeps the affected row pending, unconfirmed and excluded from output.
- If an annotation could belong to either of two rows, mark those plausible affected rows for review with an association-specific reason. Do not invent a certain assignment or block unrelated rows.
- A clear check may confirm an otherwise eligible row only when the evidence supports that row and no conflicting annotation exists.
- Preserve working Sigma19 conflict detection, Arca crosses and LALA circle handling. Unfamiliar Qualtia loops remain ambiguous unless source evidence establishes their meaning.

### User-approved workflow — separate identity from received quantity

Accurate AI reading remains the preferred end goal. Perfect OCR is not a prerequisite to a useful, reliable receiving workflow: small explicit manual inputs are an accepted solution. A reliable product proposal can be retained even when the received count is unknown. Never equate manual workflow completion with improved OCR accuracy.

- Retain the item match/proposal and preserve printed billed quantity separately.
- Clear eligible checks alone retain automatic confirmation. Numbers (including same-quantity notes), arithmetic, crosses, circles, returns, row-linked signatures/ambiguous marks and association/inspection uncertainty require individual received-piece entry.
- Show “Se detectaron anotaciones manuales en {artículo}. Indica el número de piezas recibidas físicamente.” Use uncertain wording when row association or inspection is uncertain.
- Start the received field empty. Accept explicit 0; reject empty/invalid input. Preserve product identity warnings separately and require physical identity/count attestation.
- Ask separately for each plausible neighboring item; keep unrelated rows usable. The receiver need not decipher or sum the annotation.
- Keep pending rows out of bulk confirmation/output. A physical count resolves receipt through the existing individual audit path while source handwriting can remain unreadable and preserved.
- A single invoice is not sufficient acceptance evidence. Evaluate source/OCR accuracy and receiving usability separately across a representative set of suppliers, layouts and mark types.

### Reverse direction — readable quantity, uncertain item

The user approved applying the separation in both directions. Retain readable printed/billed quantity as source/reference while asking the user to confirm or replace a visibly provisional catalog prediction. The existing review supports product proposals, alternate candidates and catalog search; no new identity-specific UI was implemented in this documentation-only closeout. Suggested clearer wording is recorded for subsequent UI work:

> No se pudo identificar el artículo con certeza. Posible artículo: {propuesta del catálogo}. Cantidad facturada leída: {cantidad}. Confirma el artículo propuesto o selecciona otro.

- Item known / quantity uncertain: enter received pieces, retain the item proposal.
- Quantity readable / item uncertain: confirm or replace the product proposal; preserve the original billed count.
- Both uncertain: resolve each separately. Both reliable: apply existing confirmation rules.
- Show available supporting evidence; do not invent confidence percentages or force a product when no useful candidate exists. Offer catalog search/selection instead.
- Keep original description/identifiers separate from the selected catalog item and retain the human-review audit. A readable billed quantity is not automatic proof of received quantity. Unresolved identity or receipt counts remain excluded from output.

This bidirectional principle should inform later fixes. Accurate AI reading remains the goal; targeted manual confirmation is an accepted reliability mechanism, evaluated separately from OCR accuracy across representative invoices.

### Implementation scope

1. Reopen original Sigma12 photos and independently verify the failed annotation and neighboring rows. Preserve uncertain arithmetic as unresolved. Private expectations must remain independent of extraction.
2. Trace image preparation, extraction schema/prompt, raw annotation evidence, reception flags, row construction, confirmation and output. Identify what evidence is absent versus ignored; do not call a rule change a visual-reading fix.
3. Implement a general approach to annotation association and uncertainty. Evaluate whether image detail or structured row-linked evidence is needed; the existing prompt already requests baseline tracing. Avoid merely repeating those instructions and claiming resolution.
4. Add meaningful synthetic regressions for competing neighboring rows, a check beside a conflicting number, unresolved association, good neighbors and output exclusion. Use private saved-result replay where applicable.
5. Record what the implementation can establish locally and what still requires a fresh image read.

Likely source files: `server/extract.ts`, `server/invoice-output.ts`, `shared/domain.ts`, `shared/receiving-policy.ts`, `server/match-extraction.ts`; inspect confirmation/export consumers as needed. Change only files required for this problem.

### Acceptance

- The known affected Sigma12 item must not be auto-confirmed while its handwritten conflict is unresolved. Its neighbor must not inherit a falsely certain correction.
- Clear notes are associated with their own rows; genuinely unclear readings remain explicitly unresolved.
- Printed quantities, item identity, source order and exact identifiers remain intact.
- A pending handwriting conflict cannot pass automatic/bulk confirmation or appear in clipboard/CSV. Unaffected eligible rows remain usable.
- Focused regressions, the existing test suite, build/typecheck and relevant private checks pass.
- Report local deterministic results separately from fresh OCR performance. A mocked result or replay cannot prove a new photo read is correct.
- Later live validation should target Sigma12 first and check preservation of relevant Sigma19/Arca/LALA behavior. Define the minimal campaign after implementation; no paid calls are authorized by this document.

### Exclusions

Do not fix LALA printed quantity shifts, compact product descriptions, source-key uncertainty wording or success diagnostics in this task. Omitted handwriting should be investigated here; Bimbo compact text remains separate. Do not disable all automatic confirmation or put every invoice row pending as a substitute for correct association.

### Completion record

- Documentation closeout: recorded the user-approved two-way item/quantity workflow and the distinction between existing product-selection controls and proposed clearer identity wording. No additional application change or test run in this documentation-only closeout. Local Task 1 is complete; fresh OCR/production acceptance remains outstanding. Next new-chat scope is Task 2 only, preserving all uncommitted Task 1 work.

- Manual-workflow follow-up: implemented shared/quantity-review.ts, the named/empty-field review in src/Review.tsx and “Por indicar / Indicar piezas” in src/App.tsx. Product matching is retained, with separate identity warnings and billed quantity. Same-quantity notes and signatures now require manual pieces; clear checks remain eligible. Explicit zero is valid. Individual confirmation records actual/confirmed quantity and resolved reasons while preserving billed/raw evidence; no real approvals or history mutations occurred.
- Final manual-workflow checks: **124 tests / 16 files**, build, typecheck, private fixture checks and whitespace pass. Ten new UI/workflow tests and an actual isolated synthetic browser interaction verify blank input stays blocked and explicit zero preserves billed quantity. Repeated 868-row replay preserves all product proposals relative to the prior replay, with 88/37/12 manual-entry rows in latest/old/new sets; all start blank/unconfirmed. Latest main/pending counts remain unchanged. Evidence: private/testing/task1-manual-20261029/REPORT.md, quantity-verification.json, verification.json, replay files and manual-prompt.jpg. Earlier evidence remains intact.
- Remaining limit: completely omitted handwriting can still miss this trigger. Fresh OCR and production workflow acceptance are unverified. Sigma12-first is a smoke check only; acceptance needs the full representative supplier/mark set. Real manual counts must come from physical receivers, never agent guesses. No paid tests, push/deploy or operational writes authorized/performed.

Initial association-only implementation record (retained for context):


- Root cause: reception evidence was evaluated only inside the provider-selected row. A check-only row could auto-confirm while its conflicting number was assigned to a neighbor. The existing baseline-tracing prompt had no separately located annotation evidence for the application to check.
- Independently reopened all five original Sigma12 photos. The handwritten 5 belongs to key 9125 / row 49 (printed 28), above key 9287 / row 50 (printed 8). Key 294's photo says 10+60 while saved OCR says 10+66. Overwritten arithmetic at key 9532 remains unresolved; no historical transcription was repaired. Reopened Bimbo: visible supplier-receipt strokes are omitted from saved reception evidence, so rules alone cannot recover them.
- Changes: new reads require a separate mark inventory, per-row inspection and printed-baseline coordinates. A general association validator compares perpendicular baseline distance/local spacing, declared candidate rows and photo-transcribed key anchors. Disagreement or missing evidence blocks plausible affected rows before confirmation; good distant rows stay usable. All marks pass reception conflict rules, including numbers beside checks, unclear checks and unresolved arithmetic. Printed billed quantity stays separate. Association diagnostics persist with the review.
- Legacy fallback: numeric notes without independent localization block the source row and its immediate same-photo neighbors with an association-specific reason. Old numeric attribution is explicitly unverified, not silently reassigned. This adds 15 pending neighbors in each Sigma replay; it is a conservative containment cost, not an OCR improvement. No historical rematch was performed.
- Files: shared/annotation-association.ts, shared/domain.ts, shared/receiving-policy.ts, server/match-extraction.ts, server/invoice-output.ts, server/extract.ts, server/workspace.ts, tests/annotation-association.test.ts and tests/invoice-output.test.ts. Image preparation, matching/catalog logic, quantities, attempt limits and retry/fencing controls are retained.
- Checks: 114 tests / 15 files pass, including 15 synthetic association regressions; full build, explicit typecheck, original private fixture checks and diff whitespace pass. Private offline replay covers latest 8/250, old 16/380 and new 13/238 invoices/rows, preserving all printed/source fields and order. Existing bulk flagged-row exclusion passes; flagged rows cannot auto-confirm or enter clipboard/CSV. Existing bundle-size warning only.
- Latest replay: Sigma12 row 49 is pending/unconfirmed/output-excluded with billed 28; row 50's billed 8 is intact and attribution is explicitly uncertain. Sigma12 retains 29 confirmed rows; Sigma19 retains 30, with all known numeric conflicts pending. Arca cross and LALA circles remain protected. Bimbo's omitted marks are not fabricated. All 500 pre-existing private files and 20 original/campaign photo pairs are hash-verified unchanged.
- Evidence: private/testing/task1-local-20261029/REPORT.md, verification-reviewed.json, verify.ts and final replay files. Saved-result replay validates safeguards only; it does not prove a new image read. Geometry uses provider-reported landmarks and synthetic-tested tolerances; omitted or mutually consistent wrong evidence can still evade it. New inventory increases tokens within existing ceilings. Fresh Bimbo mark recovery and annotation association remain unverified.
- Fresh OCR/live acceptance: NOT RUN. No push, deploy, paid call, database write, approval/quarantine, historical rematch, Retool write or operational-hub change. Daily cap remains removed.
- Proposed next action after review/push and explicit live authorization: verify the deployed version, run Sigma12 once with its five originals first, inspect all rows and annotation neighbors, stop on unsafe confirmation/coverage/geometry failure without retry. Only if it passes, validate one first attempt each for Sigma19, Arca, LALA12a and Bimbo (five scans / 16 photos total maximum). Keep unreadable arithmetic unresolved and independently verify output exclusion; no unsafe approvals. This is a proposal, not authorization.

## Task 2 — Keep printed quantities attached to their own items

Status: LOCAL ALIGNMENT SAFEGUARDS AND TARGETED REVIEW COMPLETE (29 October 2026). Fresh OCR/live acceptance NOT RUN. Task 1 changes/tests retained; Tasks 3–5 stay queued.

- Independent original-photo trace: LALA12b keys in printed order carry 3, 17, 48, 46, 4, 3, 5, 7, 4. Saved rows 2–8 use the preceding row's number; first/last counts are correct. Both LALA12a originals reopened and all 29 saved billed counts agree. No catalog-derived corrections or historical edits.
- Root cause: extraction supplied quantity inside each selected item row but no independently located printed cells. Construction/conversion trusted the pairing; successful identity matching did not certify quantity ownership. Existing image preparation preserves orientation/detail within 4000px and was retained; repeating the existing baseline-tracing prompt alone cannot fix this gap.
- Changes: mandatory independent quantityEvidence on fresh reads; item-only baselines and separately transcribed/positioned printed cells. A general validator checks perpendicular/local-spacing geometry, competing rows, one-to-one cell coverage, exact numeric agreement and photo-key anchors. It flags plausible affected rows without reassigning or inventing source quantities. Row diagnostics/landmarks persist for review. Reliable rows retain normal confirmation; uncertainty retains billed source/product proposals, withholds converted quantity/auto-confirmation and starts individual received entry blank. Product proposals can be confirmed/replaced; explicit physical zero and audit work. Task 1 annotation protections remain separate and pass combined-inventory tests. Bulk/output exclusion remains enforced.
- Local results: **142 tests / 17 files**, focused **45 / 4**, build/typecheck/private fixture checks and whitespace pass (existing bundle warning only). Added 18 synthetic quantity regressions. Exact Task 1 saved-result replay preserved across **37 invoices / 868 rows** (latest 8/250, older 16/380, new 13/238), including LALA12a behavior and product proposals. All **520 pre-existing private files** hash-identical. No push/deploy/paid extraction, real approval, database/Retool/hub write, quarantine or historical rematch; protections and removed daily cap unchanged.
- Limitations: old saved results lack quantity geometry and remain unmodified/unverified. Human-supplied approximate LALA12b landmarks contain all seven errors but also request review of correct row9 due to competing geometry. This is a review cost, not a new OCR error or proof of fresh extraction improvement. Provider omissions, wrong-but-consistent landmarks, short-line extrapolation and added response tokens remain fresh-validation risks; ceilings/retry rules retained. Physical received entry is not billed/OCR correction.
- Evidence/root-cause trace and preservation: `private/testing/task2-local-20261029/REPORT.md`, `verify.ts`, `verification-final.json`, three replay files and preservation manifests. Historical evidence unchanged.
- Proposed minimal live follow-up, only after separate explicit authorization: verify published version; LALA12b once first, inspect all nine pairs, stop on safety/coverage/alignment/truncation failure with no retry. Then LALA12a, Sigma12, Sigma19, Arca4 and Danone13 once each (**six scans / 18 photos maximum**), independently inspect every billed pair and source order, review/output containment and retained Task 1 behavior. Confirm multiline/repeated-line representation before acceptance. Report fresh OCR accuracy separately from deterministic safeguards/manual receiving usability. One passing invoice is not acceptance. No live step executed.

### User-directed pause and HTTP400 task handoff

29 October 2026: user is moving HTTP400 repair to another task and will return here afterward to finish billed-quantity alignment. Read `HTTP400-BUG-HANDOFF.md` for the comprehensive failure/attempt/evidence/code/Git/credential/test record and continuation boundaries. Original and seven-union native schemas both failed actual authenticated provider probes; current zero-union native transport is local only. The latest single-call approval was consumed; no additional diagnostic is authorized. No push/deploy/new OCR test or job reset. Preserve current uncommitted source/tests and all private evidence. Billed-quantity OCR acceptance remains outstanding; Tasks3–5 stay queued. The existing exhausted LALA job must not be bypassed. This user-directed pause supersedes any older “ready for push” language below.

### Current request repair — confirmed compiler rejection; native replacement pending acceptance

29 October 2026. This checkpoint supersedes the workaround and earlier hypotheses below. Authenticated synthetic testing reproduced the original schema's HTTP400 without photos: “The compiled grammar is too large”. One separately authorized test of the shared-definition candidate (7 distinct nullable unions, no optional fields) returned the SAME rejection (request req_011CgXWecT59SfjppgqNMfdW). Local tests and definition counts were insufficient; that candidate is not accepted. Original probe/result retained under task2-root-cause-20261029/probe-02; latest rejected probe retained under task2-native-schema-fix-20261029/provider-probe. No invoice was run or job retried during these diagnostics.

New LOCAL candidate restores native output_config.format and removes nullable unions entirely using lossless zero-or-one-element arrays in the provider response: [] is null, [value] is the exact known value. Ordinary row/evidence lists stay lists. The server decodes before original strict domain validation, matching or persistence; unknown fields, missing required fields, multiple alternatives and invalid placeholders fail closed. Zero, empty source strings, leading zeros, numeric values, geometry, annotation and billed/received separation remain intact. Both independent inventories and explicit fresh row observations remain mandatory. Native schema cardinality is described; the server enforces at most one nullable value. No fabricated placeholders, evidence removal, catalog-derived values, fallback call or automatic retry. Historical raw results remain on their original format and are not redecoded or rematched.

Validation: 151 tests/17 files (focused50/5), full build/typecheck/private fixtures and whitespace pass; existing bundle warning only. Exact saved-result replay and transport round-trip checks pass for37invoices/868rows. Legacy-only transport fixtures scaffold missing required observations solely in memory for codec testing, without certifying OCR or saving changes. All576pre-existing testing files hash-identical; prior582-file private preservation manifest also verified unchanged. Evidence: private/testing/task2-zero-union-20261029/verification.json, verify.ts and candidate-schema.json. Provider acceptance of this NEW candidate is NOT RUN; only a dry-run diagnostic is prepared. Hold push/deploy and fresh LALA testing until separately authorized provider verification passes. The previous7f16387 unconstrained workaround is not the final repair. Existing exhausted LALA job remains at2 attempts; no reset/bypass. Representative fresh OCR acceptance remains outstanding; Tasks3–5 queued. After provider acceptance: commit for user's manual push, verify published version, then separately authorize an appropriate controlled invoice validation within protections; one invoice alone is not acceptance.

### Urgent request-path hotfix after phone failure

A second invoice attempted by the user on a phone also failed at anthropic_request/HTTP400 on published2f1c3f0; the previous local mitigation had not been pushed. The final local fix **removes output_config.format from the request**, using normal Messages API output with the complete Zod-derived schema in prompt text and strict local validation before any row construction. Both evidence inventories, exact source/null semantics, annotation/quantity guards and targeted receiving remain required; invalid/malformed output fails closed. No automatic paid fallback/retry. Includes private-safe validation categories and provider request IDs. This eliminates provider grammar compilation from the request path; the exact historical rejection remains unconfirmed because its details were discarded.

**149tests /17files**, focused54/5, build/typecheck/private fixtures/whitespace pass;37invoices/868rows replay exactly preserved. Existing bundle warning only. No additional extraction, reset, approval, operational write, push or deploy by the agent. All earlier private evidence remains intact. Evidence: private/testing/task2-http400-hotfix-20261029/REPORT.md and verification.json. Ready for commit and the user's manual push; live provider acceptance and OCR accuracy still require controlled validation after the new deployment. Without constrained decoding, syntax/schema failures may increase; they remain uncertain and cannot create output. Tasks3–5 stay queued.

### Post-push HTTP400 investigation — local mitigation, not confirmed acceptance

The user manually pushed2f1c3f0. One LALA12b attempt and one explicitly authorized retry on the same job both returned provider HTTP400 at anthropic_request; no OCR output/rows/usage. The job has reached its two-attempt ceiling and remains intact. No other invoice was run. The provider's detailed rejection was discarded by the existing error sanitizer, so exact historical cause is unavailable. The expanded output schema is the leading hypothesis; schema size/definition counts do not prove a provider compiler failure.

Local follow-up simplifies shared nullable schema definitions and requires explicit fresh reception fields, reducing distinct union definitions13→7 and optional properties3→0 while preserving every evidence field and source semantics. Added safe fixed validation categories and validated provider request IDs to failure diagnostics without retaining raw provider text/input/headers. Corrected the protocol-test assumption: mocked HTTP200 only tests local serialization, not server acceptance. New offline checks cover grammar structure, required fresh observations, SDK400 handling, single request and privacy. **147 tests /17files**, focused52/5, build/typecheck/private fixtures/whitespace pass. Source parsing and row replay remain identical across37invoices/868rows;552prior private files unchanged. No further provider calls, deployment, job resets or operational writes. Evidence: private/testing/task2-request-debug-20261029/REPORT.md, verification.json and before/after schemas. Changes are local/uncommitted; the request mitigation and OCR still require controlled, separately authorized live validation after deployment. Tasks3–5 remain queued.

## Task 3 — Preserve compact product description text

Status: QUEUED.

Bimbo still loses or changes compact size digits/characters despite improved barcodes and order. Preserve exact source text and identifiers without completing descriptions from the catalog. Handwriting omissions belong to Task 1; this task addresses printed text.

## Task 4 — Give precise reasons for source-field uncertainty

Status: QUEUED.

Qualtia reports image cropping even when the source code column is in frame. Distinguish ink overlap, printed borders, actual cropping and unreadable characters per field. Recover only photo-supported characters; preserve genuine uncertainty. Do not treat every null key or pending row as an error.

## Task 5 — Persist successful extraction stop reasons

Status: QUEUED; lower priority.

Retain successful provider stop-reason metadata separately from parsed invoice content. Preserve existing failure diagnostics and usage accounting. Do not retry successful scans to populate missing historical metadata.

## Working rules for every task

- One problem per task. Record newly discovered unrelated issues for later work.
- Local implementation and unpaid validation first. User handles pushes; no automatic deployment or paid extraction campaign.
- Preserve original photos, ZIPs, hashes, baselines, raw results, histories and review records. Do not rewrite earlier scores or repair old records silently.
- No invoice-specific answers, supplier keys, expected quantities or catalog dumps in extraction prompts or public test fixtures.
- No Retool writes, operational-hub changes, unsafe approvals or automatic quarantine/rematching of historical scans.
- Keep attempt limits, duplicate protection, leases/fencing and SDK retry protection. The intentionally removed daily cap stays removed.
- Pending is a workflow state, not an accuracy score. Correctly justified pending may be correct behavior; safely contained OCR errors remain extraction errors.

Cross-user/device and adversarial live concurrency coverage remain separate follow-ups. They are not part of these extraction fixes.
