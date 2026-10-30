# Output-capacity repair — local candidate

30 October 2026. **Capacity acceptance PASS on seven selected representative reads; general OCR/automatic acceptance remains outstanding.** Hard output ceilings remain **16,000 tokens for one/two original photos and 32,000 for three through eight**. No push or deployment. These are local provider checks through the shared production request/parser/matching code, without receiving database writes.

## Why scans were consuming their allowance

The seven original representative requests exhausted all 160,000 output tokens and returned zero validated rows. Thinking accounted for 116,263 of those tokens. The other pressure was a large domain JSON document escaped inside a JSON string. Small native envelopes admitted the request but did not reserve space for a complete answer.

The repair uses a small native object of named string tables, restores the ordinary domain objects locally, then runs the original strict required/unknown-field and fresh Zod checks. Source identifiers, leading zeros, literal text, quantities, explicit reception observations, uncertainties, flags and both independent evidence inventories remain required. Version 7 uses blank cells for null and a distinct escape for a genuine empty source string; literal sentinel characters round-trip exactly. It removes repeated syntax rather than source evidence. Legacy envelopes and earlier private diagnostic table formats retain strict decoding.

## Free preflight and bounded reading

The image pass runs locally before the one provider call. It validates images and source ownership/hash, handles EXIF, fits both native edge and patch limits, retains every full original overview, and adds at most two traceable detail views per original. A strong sideways text axis rotates the COMPLETE source overview, preserving the full photo and mapping its coordinates back to the original; details use that same readable orientation. Small documents can split long dense regions with overlap when that improves text resolution; large documents keep the less fragmented preparation validated on the Sigma cases. Original-photo count controls the output cap and timeout, irrespective of view count. Prepared images have a 28M base64-character request guard.

The configured Sonnet 5.5 receives high adaptive effort for requests with at most four prepared views, except dense rotated regions; larger visual contexts and dense rotated regions receive medium. This measured workload profile is selected before the paid call and leaves response headroom; it is a heuristic, not a guaranteed thinking reservation or clean-invoice diagnosis. Other configured model families do not receive Sonnet-specific effort controls. The production path never disables handwriting inspection or uses the diagnostic no-upfront-thinking option. It has no paid classification-only call, automatic escalation, fallback call, or SDK retry.

Image coordinates are absolute unpadded prepared-view pixels. Trusted dimensions, crop regions and rotations map them back to the original oriented photo. Points outside their declared view are rejected; coordinates are never clamped or rounded to make evidence pass. Original quantity/annotation geometry and receiving/export policies are unchanged.

The final coverage table is a required audit after extraction: every original photo, including fiscal/non-item and overlapping photos, must be inspected and accounted for. Missing/incomplete declarations, invalid references and inconsistent counts fail closed. This is still model-reported evidence: a consistently false count can pass structural checks. Independent photo expectations are necessary to measure actual coverage. The audit is deliberately last to avoid forcing the model to plan future row IDs before writing source records. Column lengths are explicitly distinguished from item counts; earlier ambiguous wording produced several 17-row partial results and was removed.

## Measured provider checks

| Invoice | Rows | Effort | Output / ceiling | Pending | Est. USD |
|---|---:|---|---:|---:|---:|
| LALA12a | 29 | medium | 12,456 / 16,000 | 18 | $0.1811 |
| Sigma12 | 58 | medium | 21,452 / 32,000 | 25 | $0.2782 |
| Sigma19 | 57 | medium | 24,223 / 32,000 | 12 | $0.3180 |
| Arca4 | 31 | high | 15,387 / 32,000 | 3 | $0.1983 |
| Danone13 | 16 | high | 9,166 / 16,000 | 1 | $0.1411 |
| Bimbo27 | 27 | medium | 6,919 / 16,000 | 27 | $0.1138 |
| Qualtia7 | 23 | high | 11,353 / 16,000 | 23 | $0.1579 |

All seven selected responses ended normally, passed strict decoding, and match the current production request AND every prepared image byte exactly (unpaid reproduction). All 241 printed quantity/item pairs and original-photo row counts agree with independent pre-existing manual photo ledgers. No expected answers or catalog dump entered provider prompts. Two reviewer-note errors were separately corrected from source images (a Sigma key and an Arca key); originals and prior notes remain intact.

**General OCR/handwriting/automatic-receiving acceptance still FAILS.** One Danone source supplier key is misread; exact barcode identity still leads the unchanged receiving policy to auto-confirm that row. The exact source values and correction evidence stay in the ignored private report. LALA's doubtful loop is still called a check, although independent quantity-alignment flags keep that row unconfirmed on the selected read. Do not treat this containment as correct mark recognition. Bimbo has all 27 rows pending for excess geometry uncertainty, and LALA has 15 geometry-flagged rows despite correct printed counts. Qualtia's 23 pending rows reflect genuinely unresolved loops/dashes. Known Sigma numeric conflicts and Arca's cross/flavor conflict remain pending, but this is not exhaustive handwriting certification. Every flagged row is unconfirmed. Compact-description errors and some source uncertainties remain separate follow-up work.

The existing targeted manual workflow remains available: retain the source/product reading, withhold uncertain received counts, and require explicit human confirmation. No blanket confirmation disabling or geometry-guard relaxation was used to make these results pass. Hold unattended rollout; capacity completion is not full OCR acceptance.

Every artifact has original-photo hashes/order, exact request settings and text, native schema hash, trusted view metadata, source checkpoint and prepared views. Complete responses retain strict extraction and local matching separately. Failed outputs remain private and are never salvaged into receiving rows. Earlier failed and superseded measurements are retained independently; no historical score is overwritten.

## Verification and limits

181 tests/21 files, typecheck/build, private fixture checks and whitespace checks pass (existing client bundle warning only). The codecs round-trip 37 saved invoices / 868 rows exactly; legacy-only missing observations were scaffolded solely in memory for codec QA, never saved as new evidence. Existing matching replay artifacts are unchanged. All 707 original private files and all 742 files in the resumed-turn preservation checkpoint remain hash-identical. Request/codec/image checks include the actual SDK, malformed/truncated/refused output rejection, explicit observations, source strings/nulls/zero/escapes, pixel/crop/rotation transforms and unchanged original-photo caps.

Detailed evidence is ignored under `private/testing/capacity-repair-20261030/`: `selected-campaign-v7.json`, `selected-current.json`, `selected-request-equivalence.json`, `verification-final-resumed-v7.json`, per-attempt source checkpoints and the preservation ledgers. One diagnostic harness labelled its summary `transportVersion: 6` while its actual native request/schema/response used 7; the exact request contract and reproduction are authoritative. No historical receiving records or failed attempts were rewritten.

The selected seven checks consumed 189,419 input and 100,956 output tokens, including 54,264 thinking tokens. At the [documented standard rates](https://platform.claude.com/docs/en/models/sonnet-5-5/overview) of $2/M input and $10/M output, the estimated total is **US$1.3884**, or **US$0.11–0.32 per representative invoice**. The original seven failures consumed 160,000 output tokens and cost about US$1.8714 at those rates, producing zero validated rows. This before/after measurement has 36.9% fewer output tokens and about 25.8% lower estimated cost, with more image input; it is not a randomized comparison or a universal future price guarantee.

All repair diagnostics, including rejected/partial experiments and tiny schema probes, total **52 responses with known usage, estimated US$7.3814**. 1 interrupted request has unavailable usage and may have been billed; it is not counted as free. Billing was not independently verified. Paid calls were local development checks, not automatic extra stages in one production scan. Each production attempt still has one request, zero SDK retries, the original hard output cap and existing attempt/fencing protections.

A diagnosis label from the same reader is not independent proof that no ink or rows were missed. Higher effort and sharper views improve some cases but do not establish universal handwriting or OCR accuracy. Compact descriptions, source-uncertainty wording and successful-stop persistence remain the separate queued Tasks 3–5. This repair adds no historical rematch, job reset, retry-budget bypass, operational/Retool write or manual approval. Hosted upload/persistence acceptance has not been exercised with this local candidate. User handles pushes.

## Provider references

[Effort controls](https://platform.claude.com/docs/en/build-with-claude/effort) describe effort as a tradeoff, with thinking included in the hard output limit; the value is not a reserved JSON budget. [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) document native grammar limits and property ordering. [Vision](https://platform.claude.com/docs/en/build-with-claude/vision) and [coordinates](https://platform.claude.com/docs/en/build-with-claude/vision-coordinates) informed image fitting and trusted pixel transforms. Checked 30 October 2026.
