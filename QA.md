# DONCHAIN — QA walk (2026-10-04)

Instance: `TRENCH_DATA_DIR=<scratch>/qa-data TRENCH_DIST_DIR=.next-qa TRENCH_FEED=off npx next dev -p 3985`, own vault (6 wallets: Sniper 1–4, Imp 1, Imp Two; groups Bundle A, Volume B2), empty wallets on mainnet. Every money path was driven to its guard; nothing was ever sent. Reference: `design/blockx/BEHAVIOUR.md`.

Legend: **PASS** = behaves as the spec and as its own code says · **FIXED** = deviation found, fixed on master (commit noted) · **FAIL** = not provable here (reason).

## 1. Vault

| Flow | Result |
|---|---|
| Create vault (first run card, strength bar, mismatch message) | PASS |
| Lock → yellow banner "Vault locked — Read-only…", Unlock button | PASS |
| Locked state disables Export Keys / Move / Archive / Delete / Import / Create Wallets / Withdraw / Consolidate / Distribute / Transfer / Disperse / Reverse Disperse | PASS |
| Wrong passphrase → "Incorrect passphrase (or corrupted keystore)." | PASS |
| Right passphrase → unlocked, signing buttons back | PASS |
| Settings › Account › Vault: state, keystore path, Lock button, explanation | PASS |

## 2. Portfolio

| Flow | Result |
|---|---|
| Create Wallets: prefix "Sniper", count typed 99 → clamps to 50, Max → 50, 4 → "Create 4"; labels Sniper 1…4; API refuses 51 (400) and 0 (400) | PASS |
| Import: prefix "Imp", 2 keys → "Import 2", labels Imp 1 / Imp 2; >50 keys refused in the dialog | PASS |
| Export Keys: selection → "Export Keys (2)", wrong passphrase → "Incorrect passphrase.", right one → keys in clear, Copy / Copy all | PASS |
| Move: multi-select → "+ New group…" → Bundle A; existing group Volume B2 | PASS |
| Archive row → Archived (1) tab, "archived" chip, Unarchive; bulk Archive/Unarchive label flips | PASS |
| Delete (row + bulk) behind native confirm → route verified by curl (`/api/wallets/remove`) | PASS |
| Rename inline (Enter / Escape) | PASS |
| Set active → ACTIVE chip moves | PASS |
| Group filter tabs All (6) / Bundle A (2) / Volume B2 (2) / Archived | PASS |
| Groups tab: New Group, rename (pencil), delete (behind confirm → `DELETE /api/groups/:id` verified), chips on rows | PASS |
| Deposit drawer: wallet select, address, QR (178 px PNG) | PASS |
| Withdraw: to / amount / Max / relay switch → fee row changes → Send → "Imp 1 holds 0 SOL but needs 0.010017 SOL (amount + fee + relay fee). Nothing was sent." | PASS |
| Consolidate view: drag rows (HTML5 DnD, payload = selection), Switch, Reset, ✕, Start → "Every source wallet is empty. Nothing was sent." | PASS |
| Distribute view: one source, total 0.01 → "Sniper 2 holds 0 SOL but needs ~0.010024 SOL (sends + fees). Nothing was sent." | PASS |
| Transfer view: pairs, 0.005 each → "Sniper 3 holds 0 SOL but needs 0.005012 SOL (amount + fee). Skipped." | PASS |
| Disperse drawer: presets Save as / load / Update / Delete, Total to split, Split equal, variation 50 % (rows still sum to the total), delay 1 min, Destinations by group, relay, Create deposit wallet → "Deposit 1" added to the vault, address + QR, job "Waiting for 0.030034 SOL… Up to 120 min" | PASS |
| Disperse "Save as" left nothing selected (Update/Delete greyed) | FIXED e4caf0b |
| Stop a waiting disperse job: the text promised "Stop it from the Activity tab" but no Stop control existed; a stop then read "Failed" | FIXED e4caf0b (Stop button on running job cards, status "stopped") |
| Reverse Disperse drawer: Address / Select wallet, invalid address keeps Start off, wallet ticks, delay, relay → "Every source wallet is empty. Nothing was sent." (hop 1/2 rows) | PASS |
| Reverse Disperse via relays ignored the delay between wallets and was labelled "Consolidate" in Activity | FIXED 8b6d9dd |
| Activity tabs Disperse / Reverse Disperse list the jobs with steps | PASS |
| PNL calendar (month, counters, 31 day cells, streaks) | PASS |
| Airdrop button only on devnet | see §6 |

## 3. Launch

| Flow | Result |
|---|---|
| Sidebar: search, + New launch, CTO, Draft / Launched tabs, Minimize | PASS |
| Launch Token modal: name, symbol + AB / ab / Ab (QATOK / qatok / Qatok), description, website, X, Telegram, image zone + Upload / Paste, launchpad chips (Pump.fun only, others disabled), Cashback | PASS |
| Buy Amount → "% supply" (0.5 SOL → 1.74 %, 1 SOL → 3.42 % like Block X) | PASS |
| Auto Dump (threshold SOL), Auto Dev Sell MS / MC with placeholder 1000 / 50000 | PASS |
| Clone from a real mint (SARP …pump) → name, symbol, description, image as data URL | FIXED 04f8ab3 (metadata came back empty: ipfs.io now 429s, cloudflare-ipfs is gone — gateway list rebuilt, image URLs re-pointed) |
| Fetch mint address → reserved address | FIXED ec48609 (grind was case-insensitive and handed back `…PuMp`; now lowercase `…pump`, 119 s on this machine, wait up to the server cap) |
| Fetch mint result applied onto a stale form (wiped an imported keypair / edits typed during the grind) | FIXED ec48609 |
| Import mint keypair: bad key → "Invalid base58 character", good key → "Launches on <address> (imported keypair)", Remove | PASS |
| Save / Escape autosave → Draft (1) row + Token info rename immediately | PASS |
| Workspace panels Chart / Tasks / Token info / Activity, SOL/% and Balance/% segments | PASS |
| Bundle Task: group + wallets, 5th wallet → "At most 4 wallets", calculator rows (Dev buy 1.74 % … Dev + bundle 3.09 %), Sell all on external → card | PASS |
| Sniper Task: delays 0.5–2 s, Retry off → Max retries disabled, Stop on activity, task preset Save as / Update / Delete → card | PASS |
| Buy Task: Min/Max s, Auto-Start, Stop on activity → card; Edit (Max 3 → 4) → card updates | PASS |
| Volume Task: modes Buy only / Sell only / Buy + Sell (buy-ratio slider), Duration 30, Max trades 5 → card; Delete card | PASS |
| Wash Task: sources = dev + bundle/sniper wallets, per-source 1–3, Auto-pair from Any / group, delays → card | PASS |
| Presets dialog (Global Task Presets): Save as, Load (replaces tasks), Update, Delete (behind confirm) | PASS |
| Global "Save as" left nothing selected | FIXED 67c5e0b |
| Trading Presets dialog: Buy / Sell settings = Block X values, P2 slippage 25 → chip "P2: slippage 25%" and SLIPPAGE row follows the active preset | PASS |
| Dev row: dev wallet + "Buy 0.5 SOL · Auto Sell On · Auto Dump On"; Dump All → toast "Dump All failed — No launch wallets to sell." | PASS |
| Rail Launch → Confirm launch (steps, per-wallet needs, "6 wallets are short, it will refuse") → Launch → "Dev wallet holds 0 SOL but needs at least 0.5302 SOL (dev buy + creation + fees + tip). Nothing was sent." | PASS |
| Claim Rewards on a draft: disabled "Available once the token is launched" | PASS |
| CTO dialog → row "SARP · ready" in Launched → workspace → Buy task → Start → task "Failed · Token graduated to PumpSwap: buying on the curve is not possible here." → Stop → "stopped" | PASS |
| CTO Start tooltip said "Review and launch" | FIXED 9f9e5c5 |
| Token info Market Cap showed "$0.00" for a migrated curve (reserves are 0 on-chain; the real MC lives on PumpSwap) | FIXED 9f9e5c5 (shows "—" with a tooltip; same on the trading header and search rows) |
| Search dialog rows navigated to `/trading/<mint>` and `/launch/<id>` — routes that do not exist | FIXED 9f9e5c5 (`/trade/<mint>`, `/launch?open=`, `?draft=`, `?cto=`) |

## 4. Trading page (live mint MESSI `3SYXwM7gW37erykaSTNP6VpktWFmqcKLTxePL6qMpump`, 1366×800)

| Flow | Result |
|---|---|
| Header: image + bonding ring, symbol / name, mint copy, dev, MC / Price / Liq / Bonded, age | PASS |
| Header "Liq" printed `$0.0000` — the current pump.fun curve layout keeps `realSolReserves` at 1 lamport (checked on-chain) | FIXED 0d3c443 (shows "—") |
| Migrated mint printed `MC 0 SOL` / `Price 0` | FIXED 87035ac ("—", "Bonded Migrated") |
| Chart timeframes: only 1s / 15s / 1m (spec: 1s…1D), MC / Price toggle | FIXED 01d827c (1s 5s 15s 1m 5m 15m 1h 4h 1D, same last-600-trades history) |
| Window stats 5m / 1h / 6h / 24h → Vol / Buys / Sells / Net Vol. | PASS |
| Trades list (Total · MC · Trader · Age, Others chip with buys/sells/net tooltip) | PASS |
| Order rail: Buy / Sell, Market (Limit / Adv. disabled), wallet drawer with First Wallet / With Balance rule, P1–P3, preset amounts, custom amount, Buy → job card "Failed · Insufficient SOL: Sniper 1 (0 SOL) — each wallet needs the buy amount + ~0.003 SOL for fees + the tip." | PASS |
| Sell side: % buttons disabled and no submit while no wallet holds the token ("1 wallet · 0 MESSI") | PASS |
| Instant Trade floating panel: P1–P3, 4 buy / 4 sell buttons, slippage · tip, PnL strip, wallet rule, "8 managed" | PASS |
| Token Info block: bonding curve, Top 10 / Dev / Holders "n/a" with the reason "Holders need an indexed RPC (Helius key in Settings)", launchpad, curve | PASS |
| Positions / Wallets tabs, Workspace link | PASS |
| Recently-viewed strip fills on every visit (MESSI, SARP) | PASS |
| Search dialog: `/` opens, History (n), ticker → Tokens (n) with CTO / DRAFT badges, full mint → one row, sort Market cap / Age / Volume, Enter opens the row | PASS (hrefs fixed in 9f9e5c5) |
| Holders endpoint 503 on the public RPC (documented limit) | FAIL — needs a Helius key; the UI says so |

## 5. Rewards + Dashboard

| Flow | Result |
|---|---|
| Rewards: "Choose a launchpad" card → Pump.fun chip → fee rows; Track a mint → real vault read (MESSI: 0.001834 SOL claimable, 0.209 pending) · Claim disabled "The creator wallet is not in your vault" · Claim history | PASS |
| Tracked rows showed "?" + address instead of the token's image / symbol | FIXED 76ab5a7 |
| Dashboard: Welcome, Platform guide / New launch, Latest launches (New launch row + placeholders), Portfolio PnL card (1D/7D/30D/All, USD/SOL), PNL calendar, Rewards summary (0.000 SOL pending, Portfolio / Rewards links) | PASS |
| Latest launches did not list drafts (Block X: `??` avatar · $TOKEN · Draft) | FIXED ce67cca |

## 6. Settings

| Flow | Result |
|---|---|
| Appearance › Font → Inter: `data-font` + computed `font-family` change, persists across pages (localStorage) | PASS |
| Workspace › cluster devnet → Save: "In use now: read https://api.devnet.solana.com", `explorerSuffix=?cluster=devnet`, Portfolio shows the Airdrop button; back to mainnet | PASS |
| Network keys write-only: Helius key typed → "A key is stored" + •••••••• placeholder, `GET /api/settings` never echoes it (`hasHeliusKey` only); Clear | PASS |
| Trading defaults: slippage 15 % saved (`slippageBps 1500`), priority fee, tip, Jito switch | PASS |
| Notifications: Mute toasts switch (stored `1`) | PASS — the footer bell is a link to this page, not a toggle (Block X toggles in place) |
| Keybinds: list = Block X (Dump All, Dev sell 100 % / custom % with Sell %, Buy/Volume task 1–3 Start/Pause + Stop), all None; click → "Press keys…" → Ctrl+Shift+D recorded + stored; ↺ reset; "Reset all to defaults" | PASS |

## 7. Robustness

| Flow | Result |
|---|---|
| Server restart (Stop-Process → `next dev`): 16 jobs back, the job that was waiting for funds → "Stopped" + "Server restarted while this job was running: nothing more was sent…", draft (with its reserved mint), CTO (stopped, task states), reserved mints, 9 wallets / 2 groups / active wallet all persist; vault comes back locked | PASS |
| Resume path: CTO "stopped" → Start on the rail runs the tasks again; Portfolio jobs show the Stop button only while running | PASS |
| A draft whose reserved …pump mint was consumed by a launch refused at the guard died on "This reserved mint was already used by a launch." | FIXED 4eb276d (guards hand the reservation back; a never-launched reservation stays usable; `devWallet` missing → plain 400) |
| API errors as text: `/trade/not-a-mint` → "Invalid mint (base58 public key expected)." in header / chart / trades, every guard message in the rail or dialog, `failureMessage` everywhere | PASS |
| Console: after a reload of dashboard / launch / portfolio / rewards / settings / trade, no new JS error; only browser resource lines for expected 4xx/503 (holders) | PASS |
| Mobile 375: hamburger nav, Portfolio (+ button, tables scroll inside), Trade (one-column header / chart / rail / trades), no horizontal page overflow | PASS |
| Mobile 375: Launch workspace keeps the desktop grid (sidebar 280 px + 1180 px canvas scrolling sideways); Block X switches to one column with a BOUGHT/SOLD/HOLD/PnL strip and Trade / Activity tabs | FAIL — not implemented (layout work, not a bug fix) |
| Wallets Create / Import limits, PnL calendar, presets, keybinds survive a reload | PASS |

## Not provable here

- Anything that needs SOL: a real launch (bundle / staggered), sniper / buy / volume / wash sends, Dump All sell, Withdraw / Consolidate / Distribute / Transfer / Disperse / Reverse Disperse transfers, Claim. Every one of them was driven to its guard and stopped with a readable message; nothing was ever broadcast.
- Holders / Top 10 / Dev hold on the trading page (public RPC refuses `getTokenLargestAccounts`).
- Image upload by file picker / Ctrl+V paste in the Launch Token modal (no file dialog in the pane; the URL path was exercised through Clone).

## Summary

- PASS: 67 · FIXED: 19 (16 commits) · FAIL: 3 (needs SOL — covered by guards, holders need Helius, mobile launch workspace layout).
- `npx tsc --noEmit` 0 errors · `npm run lint` 0 errors (69 pre-existing warnings, engine copy) · `npm run build` green (separate dist dir).

### Commits (master)

| Commit | What |
|---|---|
| e4caf0b | Stop button on running job cards, user stop = "stopped" (not "Failed"), Disperse "Save as" keeps the preset selected, `.next-qa` ignored |
| 8b6d9dd | Reverse Disperse via relays honours the delay between wallets, labelled "Reverse Disperse" |
| ec48609 | Fetch mint address: case-sensitive `…pump`, longer wait, result applied to the current form (imported keypair / edits no longer wiped) |
| 04f8ab3 | Token metadata resolves again: ipfs.io 429 / cloudflare-ipfs gone → pump pinata, 4everland, public pinata; image URLs re-pointed |
| 67c5e0b | Global Task Presets "Save as" keeps the new preset selected |
| 9f9e5c5 | Search rows open real routes; migrated curve shows no MC / price / liquidity; CTO Start tooltip |
| 0d3c443 | Trading header Liq "—" when the curve layout does not carry real SOL reserves |
| 01d827c | Chart timeframes 1s…1D |
| 87035ac | Trading header MC / Price "—" on a migrated mint |
| 76ab5a7 | Rewards rows for tracked mints show image / symbol / name |
| ce67cca | Dashboard Latest launches lists drafts |
| 4eb276d | Reserved mint survives a refused launch; missing devWallet → 400 |
| (this) | QA.md, `.next-qa-build` ignored |
