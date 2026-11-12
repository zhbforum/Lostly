# Admin operations

Implementation scope: password-only owner-provisioned administrators; linked entity details and exact lookup; reports and appeals; account restrictions and session revocation; profile/media moderation; case-scoped private evidence; conversation restrictions; public decisions/notifications; assignment, workload dashboard and a global audit trail.

Policy:

- Admin accounts and roles remain provisioned by project owners outside public HTTP.
- Restrictions revoke existing sessions. A restricted user can sign in to read their moderation decisions and submit an appeal; ordinary authenticated application access is denied until expiry or removal. Existing listings and claims are preserved and can be moderated separately.
- Public decision text is separate from internal moderation reasons/notes. Other claim participants receive a generic availability notice, not the owner's private decision text.
- Private conversation/proof evidence is available only through a concrete case and an explicitly reasoned, audited reveal. Admin role alone does not grant ordinary chat access.
- Hiding is reversible. Lifecycle archive/rejection and visibility are separate. Appeals can reverse the original archive/rejection only while its guarded state still matches; subsequent claim decisions cannot be overwritten. Administrators cannot approve ownership claims or impersonate users.
- Hidden content never receives new ordinary signed URLs. Previously issued URLs expire under the existing R2 TTL policy; this change does not claim immediate URL revocation.
- All new mutations require CSRF, server-side admin authorization, a reason, and version/state checks. Audit and notifications commit with the state transition.
- Every case-linked action validates the relationship between its target and the case. Unrelated targets fail atomically, including audit and notifications. Cascading archive/reversal actions are tied to their original audited root.
- Reports capture evidence when submitted. Every appealable decision captures its own historical snapshot in the same transaction; appeals reference that snapshot, never current content or an earlier report. Profile resets retain only the affected prior fields. Ordinary case responses and generic audit metadata contain no evidence content or object keys.
- Evidence expires 90 days after capture, even while a case is open. Appeals do not extend retention. Expired evidence returns HTTP 410 before physical cleanup; evidence URLs are limited to five minutes and the remaining retention period. Older direct decisions without a historical snapshot remain explicitly unavailable rather than being reconstructed from current content.
- Production runs evidence cleanup on startup and every 15 minutes, in batches of 100. Cleanup preserves ordinary media and objects referenced by unexpired snapshots. Unreferenced expired objects (including avatar previews) are deleted before private snapshot content is cleared. A failed delete/commit leaves the row pending for an idempotent retry; failures log only an evidence identifier. Monitor `evidence_cleanup_failed` if the storage service is unavailable.

Delivery checks: migrations, API unit/integration/security/concurrency checks, Admin/Web type/build/component checks, and browser workflows covering report → assignment → moderation → notification → appeal → resolution. No deployment is part of this task.
