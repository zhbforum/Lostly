# Google sign-in

Google sign-in uses the authorization code flow with S256 PKCE. The API verifies the signed Google ID token against Google's cached public keys, including issuer, audience, expiry, authorized party, nonce and verified email. It then issues the same HttpOnly session cookie as password sign-in. Google access, refresh and ID tokens are not persisted or returned to the browser.

## Configuration

Create a **Web application** OAuth client in Google Cloud and configure the consent screen for `openid`, `email` and `profile`. While the Google project is in testing mode, add the accounts that should be able to sign in as test users.

Set these variables in `apps/api/.env` or the API host's secret configuration:

```dotenv
WEB_ORIGIN=http://localhost:5173
GOOGLE_CLIENT_ID=your-client.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
```

Register the **exact** `GOOGLE_REDIRECT_URI` as an authorized redirect URI in Google Cloud. For an API behind `/api`, include that prefix, for example `https://lostly.example/api/auth/google/callback`. Production requires HTTPS. Keep the Web and API on the same site (the same registrable domain), as required by the existing Strict session cookie; routing the API under the Web origin is also supported. No Google secret or client configuration belongs in the frontend.

Leave all three `GOOGLE_*` variables empty to disable Google authentication. Partial configuration fails at startup. Apply the `google_auth` database migration before enabling the feature. It preserves existing passwords and makes `password_hash` nullable only to support new Google-only users.

## User flow

- The login and registration pages show **Continue with Google** when the API has valid configuration. First sign-in creates a regular user with no password. Later sign-ins use Google's stable subject identifier, rather than matching email addresses.
- A password account with the same email is never automatically linked. Sign in with the password, open **Profile** from the account menu, then choose **Connect Google**. The Google email must match the Lostly email. Existing passwords, roles, reports and claims remain intact.
- Connecting requires an active Lostly session both when starting and completing the flow. A Google identity cannot be transferred to another user or replace an already connected identity. This version does not offer disconnect or password creation for Google-only users.
- Login returns to the requested internal page. Cancellation and provider failures show a message and permit retrying. External return URLs are rejected.

`POST /auth/google/start` uses the existing CSRF header and auth rate limiting. One-time state is stored in PostgreSQL, expires after ten minutes, and is consumed atomically. A temporary HttpOnly **Lax** cookie binds the flow to its browser so it can return from Google; the normal session remains **Strict**. Sign-in works across API processes and concurrent requests without duplicate accounts.

## Verification

Provider tests verify real signed JWTs with local test keys. Database/HTTP integration checks cover first and returning sign-in, concurrent creation, explicit linking, password preservation, replay, browser binding, expiry and CSRF. UI checks cover configuration, errors and connected state.

A real consent flow requires an actual Google OAuth client and authorized test account. Automated checks use a mocked token exchange and do not authenticate a real Google account.

References: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Google backend authentication guidance](https://developers.google.com/identity/sign-in/web/backend-auth).
