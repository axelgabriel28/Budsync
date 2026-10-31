# Repository Guidelines

## Project Goal

Budsync is a phone-friendly multi-wallet finance tracker for Philippine pesos. The app already includes wallet management, income and expense entries, balance adjustments, transfers, transaction history, dashboard and Insights views, receipt capture and scanning, local persistence, optional Firebase account sync, Google Drive receipt sync, and backup/export flows. Treat these as existing features; verify their behavior before changing them. Keep wallet balances and reports derived from opening balances and recorded activity. Transfers between different wallets must preserve the combined balance.

The app is still in development. `RELEASE_CHECKLIST.md` tracks manual release checks that have not necessarily been completed. Do not describe a flow as verified unless it has been checked.

## Project Structure

- `src/main.jsx` mounts the React app; `src/App.jsx` contains the main navigation, dashboard, transaction and wallet flows, Insights, and Settings.
- `src/finance.js`, `src/data.js`, and `src/insights.js` contain finance calculations, data validation/export, and insight calculations.
- `src/localStore.js` persists wallet workspaces locally. `src/cloud.js`, `src/syncReview.js`, and `src/cloudSnapshot.js` support optional Firebase account sync and conflict review.
- `src/ReceiptPage.jsx` and `src/receipt*.js` implement receipt capture, OCR, local storage, reconciliation, and links to wallet expenses. `src/googleDrive*.js` implements optional Drive receipt sync.
- `src/App.css`, `src/Fluid.css`, `src/ReceiptPage.css`, and `src/index.css` hold page, responsive, receipt, and global styles.
- `public/` contains static assets, including the app shell and OCR assets. `vite.config.js` configures Vite; `eslint.config.js` configures ESLint; `package.json` lists scripts and dependencies.

## Run and Check

Run commands from the repository root:

- `npm install` installs dependencies from `package-lock.json`.
- `npm run dev` starts the local Vite development server.
- `npm test` runs the Node test suite in `src/*.test.js`.
- `npm run lint` checks JavaScript and JSX with ESLint.
- `npm run build` creates a production build in `dist/`.
- `npm run preview` serves that build locally.

For finance changes, run the relevant automated tests and check the affected flow. The release checklist covers manual checks across wallets, balances, transfers, editing, delete/restore, filters, receipts, sync, backups, and phone layouts. Keep checklist items unchecked until they have actually been verified.

## Working Conventions

- Follow the existing JavaScript and JSX style: two-space indentation, single quotes, and function components.
- Derive wallet balances, combined totals, and reports from opening balances and entries; do not store duplicate totals.
- Require a reason for balance adjustments and edits where the UI and data model do so.
- Persist guest data locally. Treat Firebase account sync and Google Drive receipt storage as optional connections, and preserve clear local/offline behavior.
- Do not display fabricated financial activity. Sample opening balances must be clearly identified as samples.
- Keep user-facing labels accurate about sync state, data location, and limitations such as receipt images not being included in wallet backups.

## Before Editing

Before modifying files, explain the intended change in plain language, name the likely files, and say how you will check the result. Keep changes focused and understandable to a beginner. Do not add or run tests unless the user asks for testing or verification; when asked to verify, use the relevant scripts above and report what ran.

## Graphify and local memory

Budsync's generated files live outside this Git repository:

- Graphify graph: `C:\Users\axelc\Documents\My Neural Network\Graphify Data\Budsync\graph.json`
- Obsidian code graph: `C:\Users\axelc\Documents\My Neural Network\Knowledge Vault\01 - Projects\Budsync\Code Graph\`
- Concise project memory: `C:\Users\axelc\Documents\My Neural Network\Knowledge Vault\01 - Projects\Budsync\Development Memory Index.md`

When the user types `/graphify`, use the installed Graphify instructions before doing anything else. Before the first raw source search/read for a codebase question, run `graphify query "<question>" --graph "C:/Users/axelc/Documents/My Neural Network/Graphify Data/Budsync/graph.json" --budget 800`. Read source only where the graph points or where earlier inspection identified relevant lines. Use `graphify path` and `graphify explain` with the same `--graph` path for focused relationships. `GRAPH_REPORT.md` is a preserved historical snapshot; use the graph JSON for current code relationships.

The local event watcher refreshes the graph after relevant file changes. For an immediate update, run `powershell.exe -NoProfile -File "C:\Users\axelc\Documents\My Neural Network\Automation\update-budsync-graphify.ps1"`. It uses an external output path and `--no-cluster`; do not run `graphify update .` from this checkout.

Graphify excludes `node_modules`, `.git`, `dist`, `build`, temporary files, `.env*`, and `public/ocr` using built-in ignores and `.graphifyignore`. Keep Graphify output and Obsidian exports outside this repository.

Historical notes are retrieved on demand with `C:\msys64\ucrt64\bin\python.exe "C:\Users\axelc\Documents\My Neural Network\Automation\budsync_memory_index.py" search "<topic>"`. This local SQLite full-text search returns up to two matching excerpts and makes no AI/API calls.

SessionStart loads only the concise Development Memory Index. The memory Stop hook stores only a final `## Development Summary`; it does not read transcripts, save full conversations, or launch Codex.

## Development memory

After a meaningful completed Budsync development task, end the final response with an explicit `## Development Summary` section containing concise bullets for completed work, durable decisions, checks actually run, and unresolved follow-up. Do not include it for casual questions, general discussion, or incomplete work. Keep it strictly project-related and omit secrets, credentials, tokens, environment values, personal details, and copied conversation text. If a meaningful task has no useful durable update, omit the section. The local Codex Stop hook saves only that section; it does not store the transcript.
