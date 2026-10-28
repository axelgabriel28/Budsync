# Budsync (In development phase)

Budsync is a phone-friendly finance tracker for managing money across multiple wallets. Record your activity in Philippine pesos, see where your money went, and keep a clear picture of each wallet's balance. Budsync does not connect to a bank or create transactions for you.

[Open Budsync](https://budsync-6672e.web.app/)

## What you can do

- **Manage wallets.** Start with Personal, Organization, Savings, and E-Wallet, or add your own. Set opening balances; Budsync calculates current balances from those balances and your entries.
- **Record money movement.** Add income, expenses, balance adjustments, and transfers between different wallets. Search and filter history, edit entries with a reason, and restore deleted entries. A transfer changes the two wallet balances without changing their combined total.
- **Understand your finances.** The dashboard shows balances, monthly income and expenses, cash flow, spending categories, and recent activity. Insights includes category budgets and savings targets. These plans track progress; they do not move money.
- **Keep receipts with expenses.** Take a photo or choose an image, adjust it if needed, and optionally read merchant, date, amount, and line items with on-device OCR. Confirm the details before saving. You can also record an amount now and attach its image later without deducting it twice.
- **Use it on a phone.** Budsync has a responsive layout, light and dark themes, and an installable app shell. Main navigation, including Insights, is in the bottom bar; the header keeps theme and settings controls. Records remain available on the device while offline.

## Your data

Budsync saves wallet records and receipt images in your browser first. You can use it as a guest without an account. If you sign up or log in, Firebase syncs your wallet records across devices. Google Drive is a separate connection for receipt folders and images; the Receipts page shows whether an image is saved locally, waiting to upload, or in Drive.

You can download a JSON backup of wallet records or export transactions as CSV in **Settings → Data & backup**. Receipt images are not included in those exports or in Firebase account sync. Download important images individually or connect Google Drive before clearing browser data. If devices make conflicting account changes, Budsync asks you to choose which copy to keep.

## Get started

1. Choose zero or sample opening balances when you first open Budsync. Sample balances are labeled for exploration.
2. Add a wallet transaction. The form previews how the selected wallet balances will change before you save.
3. Create a receipt folder if you want to scan or attach images to expenses.
4. Open **Settings → Connections** when you want account sync or Google Drive receipt backup.

## Run locally

```sh
npm install
npm run dev
```

Open the URL printed by Vite. Copy `.env.example` to `.env.local` if you want to configure Firebase account sync or Google Drive on localhost. Google Drive requires a Google OAuth Web client whose authorized JavaScript origins include the local URL. The browser build uses the public client ID, never a client secret.

## Check a change

```sh
npm test
npm run lint
npm run build
```

Use [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) for phone, offline, receipt, and two-device checks before deploying.
