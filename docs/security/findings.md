# Security findings

Severity is the author's estimate for the local capstone setting. Status is as of 13 November 2026.

| ID | Finding | Severity | Evidence | Fix | Status |
|---|---|---|---|---|---|
| F-01 | The `/console` page builds HTML with `innerHTML` in 14 places and has no escaping function. It renders fields such as agent identity, scope, reason and package ID. Any of them that an agent can influence would be written into the page as markup. The data path from agent input to each field has not been traced | Medium until traced | `[REV]` `services/assurance-console/public/index.html` on main | Escape every interpolated value or use `textContent`. Add a Content-Security-Policy. Test with TC_SEC_001 | Open |
| F-02 | Hand-written placeholder Sprint 3 and Sprint 4 gate results and evidence packs, not produced by a run, were on main and showed PASS | Medium | Pull request 91 | Removed in pull request 91. Release gate now requires sprint records that quote a real commit and the source fingerprint | Closed |
| F-03 | The live adapter has no durable budget accounting, so live execution provenance is disabled | Medium | `[PR84]` | Add durable invocation and budget accounting, then enable live provenance | Open by design |
| F-04 | The grader is a keyword rubric and the grading-quality KPI is Red. A correct answer in other words can lose points and a weak answer can pass | Medium | `[PR90]` | Add a second independent grader or a human review sample. Keep critical rules independent of the score | Open |
| F-05 | Executor enrollment and credential custody have not had an independent review | Medium | `[PR84]` | Independent review by someone who did not write the services | Open |
| F-06 | No dependency vulnerability scan or software bill of materials is documented | Low | `[TO VERIFY]` | Run `npm audit` per service and record the baseline. Add it to CI | Open |
| F-07 | Internal service keys are shared secrets. No rotation or handling procedure is documented | Low | `[TO VERIFY]` | Write a short key handling and rotation procedure. Keep keys in the environment only | Open |
| F-08 | Traffic between services is plain HTTP inside the Compose network | Low | `[ARCH]` | Acceptable for a local capstone. Production would need mutual TLS | Accepted |
| F-09 | Development keys and identities are used in the demonstration stack | Info | `[TP]` | Marked as local and test only. Never reuse outside a local checkout | Accepted |
| F-10 | The independent human trust-boundary review named in the Sprint 1 gate was not done | Medium | Sprint 1 gate waivers | Schedule the review before final submission | Open |

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
