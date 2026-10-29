# Budsync Cloud Functions

`assessLogin` checks a reCAPTCHA Enterprise token for the `LOGIN` action before the client starts Google sign-in. It rejects invalid tokens, action mismatches, and scores below 0.5. The token is never logged or returned to the client.

## Configure and deploy

1. Copy `.env.example` to `.env` and set the same reCAPTCHA Enterprise site key used by the web client and registered for this Firebase app.
2. Grant the function runtime service account the `roles/recaptchaenterprise.agent` role in the Firebase project's Google Cloud project.
3. Deploy with `npx firebase-tools deploy --only functions:assessLogin`.
4. Confirm App Check works for the production domain and deploy the client. The callable requires a valid App Check token.
5. Review Firebase App Check metrics before enabling Authentication enforcement. The client-side assessment call alone cannot prevent a modified client from calling Firebase Authentication directly.

The reCAPTCHA site key is public. The function uses its Google Cloud runtime identity for assessment access; no service account key or reCAPTCHA secret is stored in the client.
