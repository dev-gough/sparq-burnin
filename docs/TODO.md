# Dashboard TODO

Product / engineering follow-ups that are not in an active implementation plan.

## Gradual station software-update policy

**Status:** not started  
**Why:** Manufacturing will push back on updating the frozen burn-in exe. Revoking bootstrap tokens or station credentials is the wrong club: enrolled PCs do not re-enroll on 401, recovery requires a new tokened build **and** wiping `%PROGRAMDATA%\SparQ\BurnIn\`, and history moves to a new `MFG-<uuid>`.

**Approach:** Use the existing policy poll (`GET /api/stations/v1/config`, ~30s), not enroll or revoke. Stations already gate Start Test on `enabled`. Publish a fleet-wide minimum build and deadline; the station compares its baked `releaseId` (managed manifest / enroll `appVersion`) and tightens the UI over time. HMAC identity stays put. Updating the exe is sufficient.

Suggested policy fields (additive):

```json
{
  "minReleaseId": "burnin-2026.09.1",
  "latestReleaseId": "burnin-2026.09.1",
  "updateDeadline": "2026-09-22T00:00:00Z",
  "updateMessage": "Install the current burn-in build from …"
}
```

Graduated station behavior (from `serverTime` vs deadline, while `releaseId` < `minReleaseId`):

| Window | Floor experience |
|---|---|
| Deadline > 7 days | Status/log: update available. Start Test works. |
| 2–7 days | Persistent banner. Start Test works (optional confirm). |
| < 2 days | Loud readiness text with the date. Start Test still works. |
| Past deadline | Start Test **blocked** (same as Disable) with `updateMessage`. In-flight tests still ingest. |

Ops: move the deadline / raise `minReleaseId` as the rollout proceeds. Do **not** use bootstrap-token or credential revoke as an update forcing function. Those remain for “this installer may not enroll” and “this identity is dead.”

Optional later: send `X-App-Version` on the policy poll so `/stations` can show who is stale; server-side refuse **new** work from old builds after the deadline (still accept outbox uploads).

**Repos:** `burnin` (policy payload + admin setting) + `Zigbee_UART_Interface` (compare `releaseId`, GUI copy).
