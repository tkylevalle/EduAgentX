# Acceptance record formats

These are blank formats, not completed evidence. `false` means NOT ACCEPTED.
Do not change flags to true without performing/reviewing the corresponding work.
Use the exact source SHA-256 from the tested run; include artifact paths or URLs.

Issue 7 / persistence integration owner:

```json
{
  "source_sha256": "COPY_FROM_TESTED_RUN",
  "reviewer": "",
  "evidence_reference": "",
  "postgres_redis_integration": false,
  "durable_idempotency": false,
  "consumer_recovery": false,
  "poison_out_of_order": false,
  "service_owned_permissions": false
}
```

Independent reviewer / capability backup:

```json
{
  "source_sha256": "COPY_FROM_TESTED_RUN",
  "reviewer": "",
  "evidence_reference": "",
  "clean_checkout_reproduced": false,
  "independent_reproduction": false,
  "backup_handoff": false,
  "accepted": false
}
```

The evidence reference should include the actual runtime/image versions, observed
result, date, known limitations, independent reproducer and the backup's handoff
acknowledgement. Ownership labels alone are not review approval.
