# DSH Usage Dashboard

A persistent usage dashboard for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) web app.

It shows your **DeepSeek API balance** and **local token-usage statistics** (per day, per model, per session) in a floating card with bar charts and auto-refresh — and it is installed as a **persistent composition plugin**, so it loads automatically on every DSH start and survives restarts.

![Status](https://img.shields.io/badge/status-stable-green) ![License](https://img.shields.io/badge/license-MIT-blue)

---

## Features

| Feature | Description |
| --- | --- |
| 💰 **API balance** | Live query of `https://api.deepseek.com/user/balance` (total / topped-up / granted balance, availability, currency), 60 s cache |
| 📊 **Token statistics** | Cumulative input / output / total tokens, model call count, session count — computed from your local DSH session logs |
| 📈 **Daily chart** | Last 14 days of token usage, stacked bars (input + output) |
| 📊 **Per-model chart** | Token usage per model (`deepseek-chat`, `deepseek-reasoner`, …) |
| 🏆 **Top sessions** | The 5 sessions with the highest token consumption |
| 🪟 **Floating card** | Fixed bottom-right widget, always on top: compact summary ↔ expanded dashboard |
| 🔘 **Sidebar button** | A "用量" (Usage) button at the sidebar foot (📊 in rail mode) to toggle the card |
| ⏱ **Auto-refresh** | Default every 60 s; switchable to 30 s / 1 min / 5 min / off, with anti-overlap guarding |
| ♻️ **Persistent** | Installed into the DSH profile composition — survives DSH shutdown/restart (no re-approval needed) |

## Screenshots

![Compact floating card](screenshots/floating-card-compact.png)

![Expanded dashboard](screenshots/dashboard-expanded.png)

![Sidebar "Usage" button](screenshots/sidebar-button.png)

## Requirements

- **DSH web profile** running (`npx @deepseek-ai/dsh web` or your usual launcher)
- **DeepSeek API key** configured in DSH (`Settings → Models` writes `DEEPSEEK_API_KEY` into `$DSH_HOME/.credentials.yaml`)
- **PowerShell** (for the install/uninstall scripts) — or follow the manual steps
- **Node.js ≥ 22** on the DSH host (for the zstd raw-log fast path)

## Installation

### Automated (recommended)

```powershell
# from this repository
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
```

The script:

1. Locates `$DSH_HOME` (default `~/.dsh`) and the active `web` profile;
2. Copies the plugin package to `$DSH_HOME/profiles/node_modules/dsh-usage-dashboard/`;
3. Appends the composition row to `$DSH_HOME/profiles/web/cordis.patch.yml` (idempotent);
4. Removes the old `@local/usage-dashboard` install if present (migration).

Then **restart DSH** (`npx @deepseek-ai/dsh web`). The dashboard appears automatically — no approval, no re-install.

### Manual

1. Copy `package.json` and `lib/` into `$DSH_HOME/profiles/node_modules/dsh-usage-dashboard/`.
2. Append to `$DSH_HOME/profiles/web/cordis.patch.yml`:

   ```yaml
   - insert:
       - id: usage-dashboard
         name: 'dsh-usage-dashboard'
   ```

3. Restart DSH.

### Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1
```

or manually: delete `$DSH_HOME/profiles/node_modules/dsh-usage-dashboard/` and remove the `usage-dashboard` row from `cordis.patch.yml`.

## Usage

1. Click **用量** at the sidebar foot (or the 📊 icon in rail mode) to open the floating card.
2. The compact card shows **total balance / total tokens / model calls / last update**. Click the card body (or ＋) to expand the full dashboard.
3. In the expanded view you get balance cards, token statistics, the 14-day stacked bar chart, the per-model chart, and the top-session table.
4. Use the **自动刷新 (auto-refresh)** toggle and interval selector (30 s / 1 min / 5 min), or press **刷新** for a manual refresh.
5. Close the card with ✕; reopen it any time from the sidebar button.

## How it works

```
┌────────────────────────── Browser (client half) ──────────────────────────┐
│  lib/client.js  (product __ModuleLoader__ bundle, plain React)            │
│    • registers slots: sidebar.footer.action + shell.overlay               │
│    • fetch('/usage-dashboard/data') every refresh                          │
│    • auto-refresh via the client timer service                            │
└───────────────▲───────────────────────────────────────────────────────────┘
                │ GET /usage-dashboard/data
┌───────────────┴────────────────── DSH host (host half) ───────────────────┐
│  lib/index.js  (ordinary Cordis composition plugin)                       │
│    • registers the exact HTTP route on ctx.webServer (inject: webServer)  │
│    • balance:  credentials.resolve('DEEPSEEK_API_KEY')                    │
│                → curl https://api.deepseek.com/user/balance  (60 s cache) │
│    • usage:    sessionPersistence.readRaw(id) fast path                    │
│                (raw JSONL + zstd frames, no replay validation, ~seconds)  │
│                fallback: sessionQuery.readSession                         │
│                aggregated into totals / by-day / by-model / top sessions  │
│                (5 min cache)                                              │
└────────────────────────────────────────────────────────────────────────────┘
```

- The client half is served as `/plugins/dsh-usage-dashboard/client.js` by DSH's `client-modules` service — no build step is needed because it uses the product `window.__ModuleLoader__` bundle format.
- Both halves live in one dual-face package (`package.json` → `main` for the host, `dsh.client` + `exports["./client"]` for the browser).

## Configuration

Open `lib/index.js` and adjust the constants at the top:

| Constant | Default | Meaning |
| --- | --- | --- |
| `BALANCE_TTL_MS` | 60 000 | How long the balance response is cached (ms) |
| `USAGE_TTL_MS` | 300 000 | How long the aggregated usage is cached (ms) |
| `MAX_SESSIONS` | 100 | Max sessions scanned (most recent first) |

Client-side defaults (`lib/client.js`): auto-refresh **on**, **60 s** interval.

## Data & privacy

- The API key is read through DSH's `credentials` service and is used **only** in the host process to call the official balance endpoint. It is never sent to the browser, never logged, and never leaves your machine.
- Token statistics are computed **locally** from your own DSH session logs. No telemetry, no third-party services.
- The auto-refresh toggle is in-memory only (a browser reload resets it to the default) — this follows DSH's dynamic-plugin conventions.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| DSH fails to start: `failed to parse ... cordis.patch.yml: end of the stream or a document separator is expected` | A bare `[]` line from the fresh profile template was left next to the inserted row. Re-run `scripts/install.ps1` (it now strips stray `[]` automatically), or delete the `[]` line manually |
| The card shows "余额：未配置 DEEPSEEK_API_KEY" | Configure the key in DSH `Settings → Models` |
| `/usage-dashboard/data` returns the app HTML instead of JSON | The host half did not register the route — check the DSH startup log for errors; ensure `webServer` exists (web profile) |
| First load is slow | On a fresh boot the first scan reads raw logs (normally a few seconds); if it is much slower, the `readRaw` fast path fell back to validated reads |
| After a DSH upgrade the widget is gone | Re-run `scripts/install.ps1` |

## Development

```
dsh-usage-dashboard/
├── package.json        # dual-face package metadata (host main + dsh.client)
├── lib/
│   ├── index.js        # host half: HTTP route, balance + usage aggregation
│   └── client.js       # browser bundle: React UI, slots, fetch, auto-refresh
├── scripts/
│   ├── install.ps1     # install into DSH (copy + patch, idempotent, migrates old name)
│   └── uninstall.ps1   # remove from DSH
├── screenshots/        # screenshots for the README
├── README.md           # this file
└── LICENSE             # MIT
```

To modify:

- **Host behavior** (data, caching, route) → edit `lib/index.js`, then re-run `scripts/install.ps1` and restart DSH.
- **UI** → edit `lib/client.js` (plain React via `require("react")` inside the `__ModuleLoader__` factory), then re-run the installer and restart DSH. Keep the module `id` equal to the package name.

## License

[MIT](./LICENSE)
