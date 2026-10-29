# Budsync

Budsync is a phone-friendly, cloud-synced multi-wallet finance tracker designed for managing money in Philippine pesos. It helps you track wallet balances, income, expenses, transfers, adjustments, and receipt-linked spending without duplicating totals or storing stale balance data.

This project is still in active development. Use the release checklist before shipping changes to production, and treat any flow that has not been manually verified as unconfirmed.

Live app: https://budsync-6672e.web.app/

## Why Budsync?

Budsync is built for people who want a clear, mobile-first view of their money across multiple wallets and accounts. Instead of tracking balances separately from transactions, Budsync derives balances from opening balances and recorded activity, which keeps reports and totals consistent.

Key goals:

- Track multiple wallets with separate balances and activity
- Record income, expenses, transfers, and balance adjustments
- Keep reports based on real transactions instead of stored duplicate totals
- Preserve local-first behavior for guests and offline use
- Support Firebase account sync, an Appwrite workspace database mirror, and Google Drive receipt storage
- Capture and reconcile receipts with expenses

## Features

- Wallet management with custom wallet types and opening balances
- Income, expense, transfer, and balance-adjustment entries
- Search, filtering, and transaction history review
- Dashboard and Insights views for monthly activity, cash flow, categories, and savings goals
- Receipt capture and OCR for merchant, date, amount, and line-item extraction
- Local storage with Firebase account sync and an Appwrite database copy for signed-in users
- Google Drive receipt sync and backup/export workflows
- Responsive phone-first layout with light and dark themes

## Data model and important notes

Budsync is designed around wallet balances being derived from opening balances and recorded entries.

Important rules in the app:

- Wallet balances are calculated from opening balances plus the recorded activity for that wallet.
- Combined totals are derived from the same underlying entries, not duplicated in storage.
- Transfers between different wallets preserve the total combined balance.
- Balance adjustments require a reason when the UI or data model requires it.
- Sample opening balances are clearly labeled as samples.
- Guest data is stored locally first. Signed-in workspaces sync through Firebase and are mirrored to Appwrite. Google Drive receipt storage is separate and optional.
- Receipt images are not included in wallet backups or account sync exports.

## Getting started

### Prerequisites

- Node.js
- npm

### Run locally

```sh
npm install
npm run dev
```

Then open the local Vite URL shown in the terminal.

For local development, create `.env.local` from `.env.example` and add the Firebase web app values, Google client ID, and Appwrite endpoint, project ID, and Function ID. Keep server keys out of `VITE_` variables. The Appwrite Function validates Firebase ID tokens and uses its generated, scoped runtime key to access the private workspace table.

## Project structure

- `src/main.jsx` mounts the React app.
- `src/App.jsx` contains the main navigation, dashboard, transaction flows, wallet management, Insights, and Settings.
- `src/finance.js`, `src/data.js`, and `src/insights.js` handle financial calculations, validation, export logic, and insights.
- `src/localStore.js` persists wallet workspaces locally.
- `src/cloud.js`, `src/appwriteMirror.js`, `src/syncReview.js`, and `src/cloudSnapshot.js` support Firebase account sync, the Appwrite workspace mirror, and conflict review.
- `appwrite/functions/workspace-mirror/` contains the Appwrite Function that validates Firebase ID tokens and stores private workspace snapshot rows.
- `src/ReceiptPage.jsx` and `src/receipt*.js` manage receipt capture, OCR, storage, reconciliation, and linking to wallet expenses.
- `src/googleDrive*.js` implements optional Drive receipt sync.
- `src/App.css`, `src/Fluid.css`, `src/ReceiptPage.css`, and `src/index.css` contain page, responsive, receipt, and global styling.
- `public/` contains static assets, including the app shell and OCR assets.
- `vite.config.js` configures Vite.
- `eslint.config.js` configures ESLint.
- `package.json` lists scripts and dependencies.

## Available scripts

```sh
npm install
npm run dev
npm test
npm run lint
npm run build
npm run preview
```

## Verifying changes

For finance-related changes, follow the relevant automated tests and validate the affected wallet flows manually.

Before release, use the manual checklist in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) for wallets, balances, transfers, editing, delete/restore, filters, receipts, sync, backups, and phone layouts.

## Contributing

This project is still evolving. Keep changes focused, explain behavior clearly in code and UI, and avoid introducing duplicate stored balances or hidden financial data. Preserve local-first guest behavior and make optional cloud sync features clearly distinguishable from local-only data.

## License

This repository does not currently declare a license in the root project files. Check the repository settings or package metadata before redistributing or using the project in a production environment.
