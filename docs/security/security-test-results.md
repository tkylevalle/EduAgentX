# Security test results

Date: 13 November 2026. Only checks that do not need the running stack were done. Everything else is listed with what it needs.

## Executed

| ID | Method | Result |
|---|---|---|
| TC_SEC_005 | Static check of `docker-compose.yml` on main | Pass for the rule that every published port binds to 127.0.0.1. Fourteen ports are published, so the idea that only the Gateway and the demonstration pages are exposed does not hold. See F-12 |
| TC_SEC_014 | Lockfiles of 17 services read from main. 246 locked package versions checked against the npm advisory service. Per-platform optional binaries were left out | 16 advisories in 6 packages: 1 critical, 2 high, 10 moderate, 3 low. See F-06 |

### TC_SEC_014 detail

| Package | Locked version | Advisories | Highest severity | Where it is locked |
|---|---|---|---|---|
| proxy-addr | 2.0.7 | 1 | critical | api-gateway, agent-registry, assurance-console, synthetic-agent-learner |
| body-parser | 1.20.8 | 1 | high | 16 services |
| vite | 5.4.21 | 8 | high | web |
| esbuild | 0.21.5 | 1 | moderate | web |
| qs | 6.16.0 | 1 | moderate | 10 services |
| fast-uri | 3.1.8 | 4 | moderate | curriculum-index |

Patched versions exist for body-parser (1.20.9 or later), proxy-addr (2.0.8 or later), qs (above 6.16.0) and fast-uri (3.1.9 or later). Some lockfiles already hold the patched versions, so the services are not all at the same level. The vite advisories cover versions up to 6.4.x, so fixing them means a newer major version of vite and esbuild in `services/web`, which is developer tooling.

This checks the versions in the lockfiles. It does not show that any advisory can be exploited here.

## Checked by reading code, not executed

| ID | What the code shows | Still to do |
|---|---|---|
| TC_SEC_001 | Before the fix `/console` escaped nothing. Pull request 93 escapes every string in `safeFetch`. The new code passed a Node test with an injection sample | Open `/console` in a browser after the merge with markup in an agent-influenced field |
| TC_SEC_003 | The Gateway verifies tokens with the algorithm restricted to RS256 | Run it with an expired token and a bad signature |
| TC_SEC_013 | The Gateway status route needs the admin role. The verification service status routes need the internal key | Run it against the stack |

## Not executed: need the running stack

TC_SEC_002, TC_SEC_004, TC_SEC_006, TC_SEC_007, TC_SEC_008, TC_SEC_009, TC_SEC_010, TC_SEC_011, TC_SEC_012, TC_SEC_015, TC_SEC_016, TC_SEC_017 and TC_SEC_018. Run them on a clean-machine stack and record before and after evidence for each, as the test plan says.
