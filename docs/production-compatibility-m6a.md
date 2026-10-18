# Milestone 6A — Production execution privacy and compatibility review

## Change scope

This milestone hardens existing execution log redaction when user-facing messages, structured Transform diagnostics and Output node templates contain JSON-formatted credentials. It does **not** modify stored workflow definitions, node executors' return contracts, graph routing, revision pointers, migrations or production deployments.

- Structured object/array JSON strings are recursively scrubbed using the existing sensitive-key policy. Nested credential objects (including values that are themselves JSON-encoded strings) are masked.
- Embedded JSON and quoted key-value fragments in surrounding text receive inline masking. Quoted plain-text assignments are masked without leaving suffixes after spaces or commas.
- Redaction still happens at existing persistence/console/API boundaries; this is **defense in depth, not a secret vault**. Arbitrary secret values in non-sensitive fields or opaque custom encodings cannot be reliably detected. FlowCraft should not be treated as a safe place to store credentials in arbitrary node outputs.
- Synthetic tests exercise Output console messages, serialized step previews, Transform error diagnostics, and normal public outputs.

## Disposable compatibility test matrix

| Contract | Production QuickJS behavior | Test Lab isolated behavior |
| --- | --- | --- |
| Transform object | Object fields available by their keys | Same on ordinary, non-redacted inputs |
| Transform array | Direct array result | **Wrapped** as `{ data: [...] }`; known divergence |
| Transform scalar or null | `{ data: value }` | Same output shape |
| Transform `input`, `prev`, `nodes` | Synchronous JSON-compatible values | Same basic contract, but Test Lab may redact before downstream use |
| Condition | Truthy/falsy expression selects branch | Truthy/falsy expression selects branch |
| Condition ordinary guest error | Legacy `false` branch with redacted diagnostic | **Failed step** with machine code; intentional divergence |
| Condition timeout / script limit | Fails closed | Fails closed |
| API Call | May perform approved public-network request | Always requires mock data; no network request |
| Output | Emits server log | Never emits server log |

The new compatibility tests run *real QuickJS* against representative **synthetic** workflow configurations. They are not evidence that every existing customer-saved workflow works: the test environment has no authenticated production database access.

## Review and rollout constraints

1. Review CI: backend/frontend unit tests, typecheck, lint, build, Playwright.
2. Review the final diff and ensure the new redaction paths do not change output or execution data visible to downstream nodes, only sanitized views/logs/diagnostics.
3. Treat **production vs. Test Lab array shape**, template parsing differences, fail-false semantics and already-redacted intermediate Test Lab values as explicit outstanding compatibility work for M6B.
4. Existing workflows that rely on blocked host globals or exceed QuickJS limits may still fail. Worker threads + WASM are not equivalent to OS-locked-down tenant isolation.
5. No live customer data, real secrets, or production execution were used in these regression tests.
6. No merge or production deployment until separate owner approval. A post-merge authenticated production smoke check remains required.

