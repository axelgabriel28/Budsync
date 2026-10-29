# Budsync Organization Finance Architecture

**Status:** Planned, not implemented  
**Date:** 2026-10-29

## Decision

Keep Firebase Hosting, Firebase Authentication, and the existing personal-workspace sync. Add Appwrite TablesDB for shared organization finance data and one Appwrite Function as the protected API. Keep organization receipt images in Google Drive.

## Data and access flow

1. Officers sign in through the existing Firebase Google sign-in.
2. The browser sends its Firebase ID token to the Appwrite Function.
3. The Function validates the token, derives the user ID, and checks organization membership, role grants, account/wallet scope, and lock state.
4. Authorized finance data and receipt metadata are read or written in Appwrite TablesDB.
5. Authorized receipt images are uploaded to or downloaded from the connected private Google Drive folder through the Function.

The browser never receives an Appwrite API key or the Google Drive refresh token. Budsync does not return public receipt URLs. Every receipt request passes through server-side permission checks, so Drive sharing cannot bypass Budsync permissions.

## Google Drive ownership

For a no-extra-cost pilot, connect a dedicated organization-controlled Google account and store receipts in its private My Drive folder. Keep account recovery available to at least two trusted officers. If the organization already has an eligible Google Workspace edition, an organization-owned Shared Drive is preferable because files belong to the organization rather than an individual account.

The authorized officer connects Drive through OAuth. The Appwrite Function encrypts the refresh token using a key stored as an Appwrite Function secret and stores only the encrypted token and connection metadata in Appwrite. Authorized admins can disconnect or reconnect the Drive account.

Personal Google Drive receipt sync remains separate from organization receipts.

## Access model

- Deny access by default; verify membership and scope on every request.
- Keep officer titles separate from actual permissions.
- Support roles plus scoped grants for organization, financial account, wallet, or receipt.
- Support separate view, edit, reports, receipts, budget/POWA, member administration, and wallet-lock permissions.
- Treat wallet edit locks and visibility locks as separate states with separate override permissions.
- Audit access changes, finance changes, and lock/unlock events.
- Invitation links are random, hashed at rest, revocable, single-use by default, and expire after seven days by default. Require Firebase sign-in before accepting. The server binds the invitation to the verified user and prevents privilege escalation.

## Free-tier fit and limits

A single Appwrite Function fits within the current Free plan function allowance. Thirty officers should be feasible for a low-traffic pilot if the app stays within service quotas. Monitor Appwrite usage: reaching Free plan limits can disable Function executions or API access, and inactive Free projects may be paused. Continuous production availability is not guaranteed on the Free plan.

## Not included in this phase

Budget proposal approvals, POWA workflows, monthly allocations, and forecasting are later features built on the organization/account/permission foundation. Existing personal finance data is not automatically shared with an organization.
