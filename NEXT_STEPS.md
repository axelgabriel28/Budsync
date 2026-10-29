# Budsync next steps

## Completed

- Reviewed Realtime Database rules: reads and writes remain scoped to the signed-in owner's workspace, and writes now require exactly `revision` and `payload` with sequential revisions.
- Lazy-loaded Tesseract OCR, removed OCR assets from service-worker install precache, and split the Receipts page into an on-demand chunk.
- Updated service-worker and PWA icon references to the current assets so precaching does not request deleted icon/logo files.
- Production build sizes after splitting: main JS 592.60 kB (177.21 kB gzip), Receipts JS 28.64 kB (9.45 kB gzip), OCR loader JS 17.25 kB (7.29 kB gzip). The main chunk still exceeds Vite's 500 kB warning threshold.

## Next

1. Fix Firebase App Check setup. The latest supplied reCAPTCHA Enterprise site key returned `Invalid site key or not loaded in api.js` locally. Confirm the correct key, register it for the Firebase web app, and allow the development and production domains.
2. Deploy the login-assessment Cloud Function after enabling the reCAPTCHA Enterprise API and granting its runtime service account `roles/recaptchaenterprise.agent`. Then review App Check metrics before enabling Authentication enforcement.
3. Profile the main application bundle and slow screens before further optimization. Keep the current Firebase/React stack unless measured needs justify a migration; Cloudflare Pages remains an optional frontend host.
4. Revisit a server-side API and PostgreSQL only when workspace size, query needs, or traffic justify the migration. Preserve IndexedDB offline behavior and Google Drive receipt storage unless product requirements change.
