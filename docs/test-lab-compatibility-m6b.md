# Milestone 6B — Production / isolated Test Lab compatibility

## Scope and source of truth

Production execution uses `server/src/services/execution/executors/transform.executor.ts`, `condition.executor.ts` and `templateEngine.ts`. Isolated Test Lab uses only mock API responses and the same `executeIsolatedScript` QuickJS/WASM runtime. This milestone **does not** change stored revisions, database schemas, production networking, guest sandbox settings or the production Condition error policy.

## Fixed compatibility gaps

- **Transform return shape:** a non-null object **or array** is returned directly; scalars and `null` are represented as `{ data: value }`. A shared pure `normalizeTransformOutput` helper is now used in both runtime and Test Lab. No production executor is invoked by Test Lab.
- **Downstream behavior:** arrays remain arrays in the Test Lab in-memory context; conditions can use `input.items.length` and `input.items[0]`, and safe Output templates can interpolate `{{items.0.id}}` and `{{items}}`.
- **Simple template parity:** Test Lab recognizes the same `{{...}}` delimiters as the production resolver, including paths longer than 160 characters, while continuing to reject unsafe paths and inherited/prototype lookups.

## Intentional or outstanding differences

| Concern | Production execution | Isolated Test Lab |
| --- | --- | --- |
| API Call | Guarded live HTTP request | Mock only; network request never made |
| Delay | Sleeps | Logical only |
| Output node | Emits redacted server log | Redacted result only, no log |
| Intermediate values | Runtime data is available until log/output redaction | Redacted before downstream scripts to prevent leak through assertions or diagnostic output |
| Condition guest syntax/runtime error | Legacy false branch for ordinary guest errors | Failed step + static error code |
| Condition limits/crash | Fails closed | Fails closed |
| Template lookup | Existing production resolver may look up inherited properties | Strict, own-property-only safe paths; no prototype traversal |
| Nondeterminism | Guest `Math.random()` / `Date.now()` available | Same; not deterministic |
| Unsupported host globals | Unavailable to QuickJS | Unavailable to QuickJS |

Changing guest-error false-branch semantics or exposing unredacted fixture data would be an explicit separate security/product decision, not a silent parity fix.

## Repeatable, disposable compatibility checks

CI runs `server/src/services/execution/workflowSimulation.parity.test.ts` with **synthetic** graphs and real QuickJS:

1. Direct arrays, empty arrays, full-value assertions, index assertions and downstream true-branch paths.
2. Object/scalar/null returns, positional templates, long field names and explicit prototype-path denial.
3. Mock-only API behavior with no host fetch, and secret masking before downstream scripts.
4. Guest errors, script limits and the documented legacy production Condition-error divergence.
5. Existing revision ownership and integrity checks in `workflowSimulation.isolated.test.ts`; production Transform compatibility in `executors/executionCompatibility.test.ts`.

Run `npm run test --prefix server` and all repo CI steps. These tests do not create, update or delete MongoDB workflows, contact external APIs, or require live credentials. Browser tests validate UI pathways with intercepted API calls, not authenticated live production execution.

### Production smoke validation after merge

A safe end-to-end production smoke check still requires owner-approved authenticated access. Use a **dedicated disposable workflow and test account only**, never a customer's saved graph; record workflow revision/hash, exercise a small array Transform + Condition + Output branch, verify logs are redacted, and dispose of test artifacts with approval. Do not run the existing broad production smoke script automatically: its live demo workflow and provider calls have effects. No production smoke check or production compatibility certification is claimed by this PR.

## Rollout gate

Review the final diff, complete GitHub CI, inspect deployment implications, and obtain explicit separate approval before merging. Run post-merge checks and separately confirm any live smoke result. OS/container-level isolation and workload quotas remain relevant future hardening for multi-tenant customers.
