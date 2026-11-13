# Security test cases

These extend the test plan. Cases with a test plan reference already exist there. New cases will be written in the CSIT314 template for the test plan amendments in the final test report. Results are not filled in here.

| ID | Test | Type | Covers | Test plan case |
|---|---|---|---|---|
| TC_SEC_001 | Put markup in an agent-influenced field (the agent key if the token subject allows it, otherwise a declared model or tool name). Open the Console Lifecycle view. The text must show literally and no script may run | Failure | T16, F-01 | new |
| TC_SEC_002 | A token for agent A tries to register agent B | Failure | T01 | related to TC_REG_002 |
| TC_SEC_003 | An expired token and a token with a bad signature are both refused | Failure | T01 | related to TC_GW_002 |
| TC_SEC_004 | Call an internal service from inside the network without the internal key or with the wrong actor role | Failure | T12, T14 | new |
| TC_SEC_005 | List the ports published on the host. Only the Gateway and local demonstration pages appear, all on 127.0.0.1 | Success | T14 | new |
| TC_SEC_006 | Send 601 requests in 60 seconds. The 601st is refused | Failure | T03 | TC_GW_004 |
| TC_SEC_007 | Send an oversized or malformed envelope. It is refused and nothing is stored | Failure | T04 | related to TC_REG_002 |
| TC_SEC_008 | Resend an idempotency key with a changed body. The answer is 409 | Failure | T04 | TC_EXM_003 |
| TC_SEC_009 | On a temporary branch, commit a `.env` file and a private key block. The release gate must block | Failure | T17 | new |
| TC_SEC_010 | After a full lifecycle run, search the logs for tokens, request bodies, headers and URLs. None may appear | Success | T11 | new |
| TC_SEC_011 | A credential signed with `alg` set to none, or a non-approved algorithm, is invalid | Failure | T09 | TC_VER_005 |
| TC_SEC_012 | Send a registration or response that claims a live or replay mode. The mode is taken from the enrolled executor and the claim is ignored | Failure | T05, T07 | new |
| TC_SEC_013 | Suspend and revoke without an administrator role are refused | Failure | T10 | TC_VER_006 |
| TC_SEC_014 | Run `npm audit` on every service and record the count of high and critical findings | Success | T19, F-06 | new |
| TC_SEC_015 | The evidence bundle contains no raw answers, keys or tokens | Success | T11 | TC_EVB_002 |
| TC_SEC_016 | A POST to a Console route is refused and nothing changes | Failure | T15 | TC_CON_002 |
| TC_SEC_017 | Set the live call bound low. The live run halts when it is reached | Failure | T22, F-03 | Hero scenario 5 in `docs/sprint-5/hero-scenarios.md` |
