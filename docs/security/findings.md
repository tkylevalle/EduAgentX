# Security findings

Severity is the author's estimate for the local capstone setting. Status is as of 13 November 2026.

| ID | Finding | Severity | Evidence | Fix | Status |
|---|---|---|---|---|---|
| F-01 | The `/console` page builds HTML with `innerHTML` in 14 places and has no escaping function. It renders fields such as agent identity, scope, reason and package ID. Any of them that an agent can influence would be written into the page as markup. The data path from agent input to each field has not been traced | Medium until traced | `[REV]` `services/assurance-console/public/index.html` on main | Escape every interpolated value or use `textContent`. Add a Content-Security-Policy. Test with TC_SEC_001 | Fix in pull request 93, not yet merged |
| F-02 | Hand-written placeholder Sprint 3 and Sprint 4 gate results and evidence packs, not produced by a run, were on main and showed PASS | Medium | Pull request 91 | Removed in pull request 91. Release gate now requires sprint records that quote a real commit and the source fingerprint | Closed |
| F-03 | The live adapter has no durable budget accounting, so live execution provenance is disabled | Medium | `[PR84]` | Add durable invocation and budget accounting, then enable live provenance | Open by design |
| F-04 | The grader is a keyword rubric and the grading-quality KPI is Red. A correct answer in other words can lose points and a weak answer can pass | Medium | `[PR90]` | Add a second independent grader or a human review sample. Keep critical rules independent of the score | Open |
| F-05 | Executor enrollment and credential custody have not had an independent review | Medium | `[PR84]` | Independent review by someone who did not write the services | Open |
| F-06 | CI has no dependency scan. An audit of 246 locked package versions in 17 services on 13 November 2026 found 16 advisories in 6 packages: 1 critical (proxy-addr 2.0.7 in api-gateway, agent-registry, assurance-console and synthetic-agent-learner), 2 high (body-parser 1.20.8 in 16 services, and vite in web), 10 moderate and 3 low. Exploitability was not checked | Medium | `[REV]` TC_SEC_014 | Update body-parser, proxy-addr, qs and fast-uri to patched versions. Treat vite and esbuild in web as developer tooling. Add `npm audit` to CI | Open |
| F-07 | Internal service keys are shared secrets. The spec says humans control key rotation and requires a key rotation test, but no operating procedure was found in the repository | Low | `[REV]` repository search | Write a short key handling and rotation procedure. Keep keys in the environment only | Open |
| F-08 | Traffic between services is plain HTTP inside the Compose network | Low | `[ARCH]` | Acceptable for a local capstone. Production would need mutual TLS | Accepted |
| F-09 | Development keys and identities are used in the demonstration stack | Info | `[TP]` | Marked as local and test only. Never reuse outside a local checkout | Accepted |
| F-10 | The independent human trust-boundary review named in the Sprint 1 gate was not done | Medium | Sprint 1 gate waivers | Schedule the review before final submission | Open |
| F-11 | Redis runs with no password or access control (`redis-server --appendonly yes`). It carries the event streams, is reachable by every container and is published on host loopback | Medium | `[REV]` `docker-compose.yml` on main | Set a password or per-service access control users and stop publishing the port | Open |
| F-12 | Fourteen ports are published to the host, all on 127.0.0.1: PostgreSQL, Redis, ChromaDB, the Gateway, the demonstration pages, Validation, Grading, Verification, Monitoring, Evidence Bundle, Prometheus and Grafana. This is wider than the architecture rule that the Gateway is the only public entry | Low | `[REV]` TC_SEC_005 | Fine for a local demonstration. Do not run this compose file on a shared host | Accepted |
| F-13 | The curriculum index compares its internal key with a plain comparison and has no missing-key check in code. Compose refuses to start without the key, so the stack itself is safe | Low | `[REV]` `services/curriculum-index/index.js` | Reuse the constant-time comparison from the verification service and return 503 if the key is missing | Open |

## F-01 in detail

What was checked: the page source on main. It has 14 `innerHTML` assignments and no escaping function. The older server-rendered console page does escape its output.

What was not checked: which rendered fields can carry text chosen by an agent. Agent keys are tied to provisioned client credentials, so a free-form key may not be possible. Declared values such as model name or tool names, and event reasons, still need tracing.

Attack, if a field is agent-influenced: the value contains markup such as `<img src=x onerror=...>`. The Lifecycle view writes it into the page, so the browser runs the script when an administrator opens it.

Impact: the script runs in the Console origin. The Console has no mutation routes, so the impact is limited to reading what the Console shows and changing what the administrator sees.

Fix pattern:

```js
const esc = (value) => String(value ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// every template value goes through it:  `<div>${esc(a.agentId)}</div>`
```

Check: put `<b>x</b>` in an agent-influenced field and open the Console. It must show the literal text and must not bold it.

Status: pull request 93 escapes every string in `safeFetch`, the single entry point for service data. The new code was tested in Node against an injection sample. It has not been tested in a browser against the live stack.

## Checked and found sound

- Tokens are verified with the algorithm restricted to RS256 and last 900 seconds by default `[REV]`.
- Credential status changes need the admin role at the Gateway. The verification service also needs its internal key, compared in constant time, and returns 503 if the key is missing `[REV]`.
- Compose refuses to start without `CURRICULUM_INTERNAL_KEY` `[REV]`.
- Evaluation test clients in pull request 90 must match a fixed ID pattern, get the agent role only, and a bad roster fails closed `[REV]`.
- The new reconciliation routes in pull request 90 are GET only and need the admin role `[REV]`.
