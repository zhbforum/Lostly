# Admin operations

Implementation scope: password-only owner-provisioned administrators; linked entity details and exact lookup; reports and appeals; account restrictions and session revocation; profile/media moderation; case-scoped private evidence; conversation restrictions; public decisions/notifications; assignment, workload dashboard and a global audit trail.

Policy:

- Admin accounts and roles remain provisioned by project owners outside public HTTP.
- Restrictions revoke existing sessions. A restricted user can sign in to read their moderation decisions and submit an appeal; ordinary authenticated application access is denied until expiry or removal. Existing listings and claims are preserved and can be moderated separately.
- Public decision text is separate from internal moderation reasons/notes. Other claim participants receive a generic availability notice, not the owner's private decision text.
- Private conversation/proof evidence is available only through a concrete case and an explicitly reasoned, audited reveal. Admin role alone does not grant ordinary chat access.
- Hiding is reversible. Lifecycle archive/rejection and visibility are separate. Administrators cannot approve ownership claims or impersonate users.
- Hidden content never receives new ordinary signed URLs. Previously issued URLs expire under the existing R2 TTL policy; this change does not claim immediate URL revocation.
- All new mutations require CSRF, server-side admin authorization, a reason, and an expected version where the target can change. Audit and notifications commit with the state transition.

Delivery checks: migrations, API unit/integration/security/concurrency checks, Admin/Web type/build/component checks, and browser workflows covering report → assignment → moderation → notification → appeal → resolution. No deployment is part of this task.
