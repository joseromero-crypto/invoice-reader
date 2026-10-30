# Invoice request HTTP400 repair

The provider rejected the expanded native response schema because its compiled grammar was too large. Removing nullable unions, date constraints, shared references and nesting did not produce an accepted full-contract schema. A minimal native control succeeded, isolating the defect to the response contract rather than an invoice image.

The worker now sends a fixed, small native JSON schema: one required `invoice` string in a closed object. That string contains the JSON-serialized complete invoice object. The full invoice contract appears in the user instructions instead of the provider grammar.

After a complete `end_turn` response, the server requires one text block, parses the closed envelope and inner JSON, recursively checks required/unknown fields, and applies the original fresh Zod contract. Both independent evidence inventories and explicit per-row reception observations are required. Bad types, dates, enums, geometry, missing evidence and partial output fail before matching or persistence. Decoded raw results retain the existing scalar/null domain contract, so saved history requires no migration.

This changes where validation happens: the provider guarantees the envelope; the application validates every inner field. Invalid inner JSON can still fail a scan. The transport adds escaping/output overhead and two single-photo tests do not establish multi-page token capacity. There is no unconstrained fallback or automatic second request. Existing token ceilings, image limits, job attempts, duplicate protection and fencing remain intact.

`server/invoice-request.ts` shares the production prompt and image preparation with `scripts/smoke-invoice.ts`. The diagnostic is local, requires explicit `--send`, uses retries zero, refuses existing evidence directories, and never connects to the receiving database. Production still performs authorization, ownership/hash checks, reservation validation, matching and fenced persistence in `extractJob`.

Validation on 29 October 2026: 153 tests/18 files, build/typecheck and private fixtures pass. All 37 saved invoices/868 rows replay identically and round-trip through the envelope without changing source data. Two real original photos completed with the actual production request/parser: 3 and 17 rows, all printed quantities checked, with four catalog-related rows correctly left pending. The three-row result also rendered in the local review UI. Private originals, results and request ledgers remain ignored.

Hosted upload, authentication, dispatch, storage and DB persistence were not rerun by this local diagnostic. Deploy through the user's normal manual push, verify the published commit, then perform hosted acceptance under existing attempt protections. Do not reset exhausted jobs. Separately, an original 50MP photo was rejected by the unchanged 40MP input limit before any provider call; that is a different image-validation issue.
