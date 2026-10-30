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

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.

## Development memory

After a meaningful completed Budsync development task, end the final response with an explicit `## Development Summary` section containing concise bullets for completed work, durable decisions, checks actually run, and unresolved follow-up. Do not include it for casual questions, general discussion, or incomplete work. Keep it strictly project-related and omit secrets, credentials, tokens, environment values, personal details, and copied conversation text. If a meaningful task has no useful durable update, omit the section. The local Codex Stop hook saves only that section; it does not store the transcript.
