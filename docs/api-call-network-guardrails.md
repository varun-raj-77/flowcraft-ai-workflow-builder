# Milestone 4 — API Call outbound network guardrails

**Scope:** Security hardening for real **API Call** workflow nodes. This milestone does not enable sandboxed execution of user JavaScript: the existing Transform and Condition executors still use `new Function()` in the server process. A separate isolation milestone is required before untrusted multi-tenant production usage.

## Outbound HTTP guardrails

The new transport in `server/src/services/execution/executors/publicHttpTransport.ts` implements:

- Only absolute HTTP(S) URLs, no embedded URL credentials, fragment identifiers, local/internal hostname aliases, IPv6 destinations or private/reserved IPv4 destinations
- IPv4 A-record validation **at socket connection time**, using a custom DNS lookup attached to Node's HTTP transport, rather than a preflight DNS check followed by a second uncontrolled lookup
- Denial of mixed private/public DNS A-record answers; no automatic redirects (including public to localhost/metadata redirects)
- No caller-defined `Host`, `Content-Length`, `Connection`, `Transfer-Encoding`, proxy-related or connection-upgrade headers
- 64 KiB request body limit, 512 KiB streamed response body limit, bounded response headers, 100–30,000 ms total-time limit and explicit HTTP verb allowlist (GET/POST/PUT/DELETE)
- Generic error messages without logging full URLs or network stack details. Existing auth/session/owner checks and immutable workflow revisions remain unchanged.

The existing downstream contract stays `{status, data, headers}` for eligible HTTP responses. JSON responses are parsed when Content-Type includes `application/json`; non-JSON responses are returned as text.

## Breaking changes to review

These restrictions intentionally reject formerly accepted unsafe inputs:
- Requests to local/private networks, IPv6 addresses or IPv6-only hosts (future IPv6 policy can be added with explicit address validation)
- Redirecting endpoints (the caller should use a known public final URL instead)
- Responses above 512 KiB and request bodies above 64 KiB
- Custom HTTP routing/hop-by-hop headers

**This is an intentional behavior change.** Existing saved workflows are not modified, but running a saved workflow that depends on newly blocked destinations or behavior will return a clear execution error. Before release, smoke test the existing public API examples and evaluate whether any legitimate user flows require a more narrowly scoped exception.

## Threats not addressed

- **User-authored JavaScript:** Transform and Condition nodes still execute via `new Function()`. No AST filter or Node VM sandbox is claimed to make these safe; design a genuinely isolated, low-privilege worker environment separately.
- Public Internet egress still allows user workflows to call arbitrary publicly routable IPv4 services. Add business-level host policies and per-user budgets for a broader SaaS launch.
- HTTP responses are bounded by raw network bytes; compressed response handling is not introduced in this change. Content-Encoding response bodies are not transparently decompressed by the Node HTTP transport.
- No automatic credential storage or authentication secret manager is provided.
- This change does not provide a full security audit of third-party dependencies or the hosting perimeter.

## Verification

CI covers unit tests, typecheck, lint, build and Playwright. New tests exercise loopback/metadata URL rejection, DNS rebinding to private A records, mixed DNS answers, redirects and payload/header/timeout budgets. A live authorized production smoke test remains required **after explicit merge approval**.

Never merge or deploy this PR without explicit approval.
