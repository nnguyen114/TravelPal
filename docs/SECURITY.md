# Security review (before AWS)

Reviewed 2026-11-13, ahead of Stage 6: keys, sign-in and sign-out, personal data, and who can reach what.
Each fix has a test that fails if it regresses.

## Fixed

| Area | Problem | Fix |
|---|---|---|
| Sign-out | Logging out stopped the refresh token, but the access token kept working for up to 15 minutes. | Every access token names its session (`sid`). Logging out ends that session in Redis and core-api refuses its tokens at once. Other devices stay signed in. |
| Stolen refresh token | When reuse was detected, the thief's access token stayed valid for 15 minutes. | Reuse now ends the session the same way, so access tokens stop working immediately. |
| Refresh race | Two requests with the same refresh token at the same moment could both succeed, which slips past reuse detection. | Using a token is now one conditional `UPDATE`, so only one request can win. Tested with 6 concurrent requests. |
| Password guessing | The limit was 10 attempts a minute per IP only, so many IPs could guess at one account. | Added a second limit: 10 attempts per 15 minutes per account, across all IPs. |
| Limits across servers | Rate limits and AI quotas were counted in each server's memory, so N servers allowed N times the limit. | Counters live in Redis and are shared by every task. |
| Client IP behind CloudFront | Every request would look like it came from a CloudFront edge, so the per-IP limit would hit unrelated people together. | The real client IP comes from `CloudFront-Viewer-Address`. The ALB accepts only CloudFront, so clients can't forge the header. |
| Missing keys in prod | Without keys, core-api quietly made throwaway signing keys. Tokens would then fail at random across tasks. | AWS sets `DEV_KEYS=false`, and startup fails if a key is missing. |
| Cached data after sign-out | After a sign-out, the next person on that browser could briefly see the previous account's trips. | Signing out clears the data cache. It also forgets the access token even if the server can't be reached. |
| Error details | Unexpected errors could return internal exception messages, such as SQL text. | Turned off (`server.error.include-message` default). Deliberate messages still show. |
| Probing ids | Moving a place or closing a proposal checked whether the item existed before checking access, so a non-member saw a different "not found". | Access is checked first everywhere. |
| Map search abuse | Any account could send unlimited searches through our server to the free map service. | Limited to 300 searches an hour per account. |
| Personal data | There was no way to delete an account. | Added **Delete account** (password required). It removes the account, its sessions and its taste data (the link to places they added, and their "not interested" list). Trips they solely own go to the longest-standing member, or are deleted if no one else is in them. Invite links they made stop working. |
| Old sessions | Expired refresh tokens were kept forever. | They are deleted nightly. |

## Checked, no change needed

- **Passwords:**
  - Hashed with Argon2id.
  - Unknown-email and wrong-password logins return the same message and take the same time.
  - Passwords must be 10–128 characters.
- **Tokens:**
  - Access tokens use ES256 with the issuer checked and last 15 minutes.
  - Refresh tokens are 256-bit random values stored only as SHA-256 hashes.
  - The refresh cookie is HttpOnly, Secure and SameSite=Strict, scoped to `/api/auth`, and rotated on every use.
  - The access token is held in memory only, never in localStorage.
- **Service to service:**
  - core-api signs 60-second tokens for ai-service with a separate key (`aud=ai-service`).
  - ai-service has no public entry and only accepts traffic from core-api.
- **Access:**
  - Every trip endpoint goes through `TripAccess` (viewer, editor, owner).
  - Non-members get 404.
  - Item ids are always looked up within their trip.
- **Invites:** 256-bit tokens, stored hashed, expire after 30 days, and owners can revoke them.
- **What reaches Claude and Voyage:** trip contents and place names only. No emails, names or account ids.
- **Link import:**
  - Only public addresses are fetched.
  - Each hop is pinned to the IP that was checked.
  - Fixed error messages are returned.
- **Secrets:**
  - None are in git history (gitleaks runs in CI).
  - `.env` is gitignored.
  - In AWS, keys sit in Secrets Manager and are put there by a script, so they never pass through Terraform state.
- **Infrastructure:**
  - Trivy finds no high or critical misconfiguration; the three deliberate exceptions are commented in the code.
  - Data is encrypted at rest and in transit: RDS, Redis, SQS and S3.
  - Containers run as a non-root user.

## Accepted risks (revisit as usage grows)

- **Registration reveals whether an email is already registered.** This is common and rate-limited. Hiding it needs email verification first.
- **There is no email verification or password reset.** Both need an email provider.
- **Session ends depend on Redis.** If Redis is down, signed-in requests are refused (fail closed). Redis runs Multi-AZ with automatic failover.
- **Activity history keeps names.** Entries such as "removed Alex" keep their text after Alex deletes their account. Places they added stay in shared trips (without their name).
- **Removed members briefly see activity.** A removed member's open live-update connection still receives "something changed" pings for up to 30 minutes. The pings carry no trip data, and every fetch is refused.
- **The Redis password is in Terraform state.** The state bucket must be private and encrypted.
