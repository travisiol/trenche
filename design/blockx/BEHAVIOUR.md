# Block X (blockx.gg) — functional behaviour spec

Observed 2026-10-04 on the Solana chain, logged in (Discord account "DarkGPT"), viewport 1440×900, account with **zero developer wallets**, one draft launch. Everything below was seen in the browser unless marked **docs:** (from docs.blockx.gg). Items marked **requires a dev wallet** could not be opened without creating a wallet.

Companion files in this folder: `*.html` = rendered DOM of the named modal/panel (scripts/styles stripped, SVG emptied, repeated siblings capped at 3), `shots/*.jpg` = 800×500 screenshots, the two `css-*.css` files are Block X's own stylesheet (Tailwind utilities + theme variables).

Conventions: `label → behaviour`. "toast" = bottom-right notification (position configurable in Settings → Notifications). Amounts: SOL unless stated. Every page keeps the same top bar, holdings strip and bottom bar.

---

## 0. Shell (every page)

### 0.1 Top bar (56 px)
- **BLOCKX** wordmark → `/sol/dashboard`.
- Nav links: Dashboard `/sol/dashboard` · Trenches `/sol/trenches` · Trending `/sol/trending` · Launch `/sol/launch` · Portfolio `/sol/portfolio` · Rewards `/rewards` · Subscription `/subscription` · Tools `/tools` · Settings `/sol/settings`. Chain-scoped pages are prefixed by the chain slug (`/sol/…`); Rewards/Subscription/Tools are global. Active link is accent-coloured.
- **Search box** "Search name, ticker, CA" with `/` hint → opens the **Search tokens** dialog (centred, ~800 px wide, Esc chip top-right closes it):
  - Row 1: launchpad filter chips **Pump · Bonk · StonkFun · Bags · Graduated** — toggles (active = accent border/15 % fill); they filter the result list, several can be on.
  - Row 2: text input "Search by name, ticker, or CA" (autofocused).
  - Empty input: section **History (n)** = tokens recently opened (row shows image, symbol, name, copy icon, MC/V/L dashes if unknown).
  - Typing a ticker/name (e.g. `clanker`): section **Tokens (n)** after ~300 ms; each row = image + launchpad badge, **SYMBOL** name, copy-address button, age (`3d`), pad icon + website icon + `@twitter` handle, then capsules **MC $… · ATH $… · V $… · L $…** (24 h volume, liquidity). Click row → `/sol/trading/<mint>`.
  - Typing a full mint (44 chars): one row with truncated `Fa8z…sZem` as name/symbol if metadata is not cached (MC/V/L still filled, ATH `—`).
  - Sort icons right of the "Tokens" header: **Market cap** (default, accent) · **Age** · **Volume** · **Liquidity** — clicking re-sorts the list.
- **Chain selector** (Solana logo + name + chevron) → dropdown: **Robinhood · BSC · Solana (checked) · Arc**. **docs:** "Tools, wallets, and pads follow the active chain from this switcher."
- Avatar + **DarkGPT** (plain label, no menu) and a **Logout** button.
- Mobile (<~1100 px): nav collapses into a hamburger "Open navigation"; the launch workspace switches to a one-column layout with a BOUGHT/SOLD/HOLD/PnL header strip and **Trade / Activity** tabs (shot `launch-workspace-mobile.jpg`).

### 0.2 Secondary strip ("holdings strip")
- Left icons: **Holdings strip settings** (gear) → popover `HOLDINGS STRIP: Recently viewed (on) / Hidden`; **Hide recently viewed** (history icon, pressed = strip visible); a third icon = layout.
- Content: "No recently viewed tokens" until you open a trading page; then one chip per token (image + symbol, newest first, e.g. **ELON · Clanker**) linking to `/sol/trading/<mint>`. It fills automatically on every `/sol/trading/*` visit (also when the Platform guide tour opens one).

### 0.3 Bottom bar
- Left: **Trenches** overlay toggle, **Trending** overlay toggle, **X** (X tracker overlay) — each opens a draggable/dockable footer overlay (same as Layout → OVERLAYS). **docs:** the X tracker shows live posts from tracked accounts with name/ticker ideas and a Deploy button that opens Launch pre-filled.
- **Quick Launch 1** button + **Quick Launch settings** (gear) → popover `QUICK LAUNCH`: three slots **1 / 2 / 3** (radio), each with a `<select>` "Quick Launch n preset" listing the Global Task Presets ("No presets" when none). The button launches the selected slot's preset in one click (needs a dev wallet + a preset).
- Prices: **BTC $85.3K · SOL $121.67 · BNB $788.65 · ETH $2.70K** (live, coin icons).
- Status pill: **Stable · 46 MS · 1 FPS** (tooltip "Frontend host latency and UI frame rate").
- **Layout** → popover: `WORKSPACE UI: UI 1 (on) / UI 2 · OVERLAYS: Trenches / Trending / X · SHELL: Launch sidebar · HOLDINGS STRIP: Recently viewed (on) / Hidden`.
- **Mute notifications** (bell) → toggles toasts; shows toast "Notifications off"; aria-label becomes "Unmute notifications". Same switch as Settings → Notifications → Show notifications.
- **Theme** → dialog `Theme`: Block X · GMGN · GMGN Old · Light · Pink · Axiom · Photon · BullX · Hyper · Custom; `Font` select (Geist (Default) · Inter · IBM Plex Sans · DM Sans · Space Grotesk · System UI); **Import / Export / Done**.
- Links: Discord `discord.gg/blockx`, X `x.com/blockxgg`, **Docs** `docs.blockx.gg`.

### 0.4 Platform guide (12-step tour, button on Dashboard)
Steps and the page each one navigates to: 1 intro · 2 chain switcher ("Solana, BSC, Robinhood, and eventually more") · 3 top nav · 4 **Trenches** ("Click a card to open trading, click the address to copy, and use filters or quick buy per column") · 5 **Launch** ("Create tokens across pads, manage drafts and live launches from the sidebar, and open a workspace to run tasks") · 6 "Hit New launch to pick a pad, set buy amount, attach wallets, and confirm" · 7 **Trading** at `/sol/trading/Fa8z…` ("multi-wallet buy/sell. From a launch you can also add Tasks like Volume or Buy") · 8 **Portfolio** ("create or import, group them, deposit and withdraw, then consolidate, distribute, convert, disperse, mix, and reverse-disperse. Track holdings, activity, and PnL; archive wallets or export keys") · 9 **Rewards** ("Scan wallets for developer fees across supported pads, fund gas if needed, and claim in one flow") · 10 **Referrals** · 11 **Settings** ("Themes, workspace layout, keybinds, notification prefs, and KOL Tracker") · 12 back on Dashboard. Buttons: Skip · Back · Next · Finish; backdrop click dismisses.

---

## 1. Dashboard `/sol/dashboard` (shot `dashboard-full.jpg`, DOM `dashboard.html`)

Header: **Welcome back, DarkGPT** · "Solana overview — launches, portfolio PnL and live signal." · buttons **Platform guide** (tour) · **New launch** (accent; creates a draft and opens Launch — not clicked).

Three columns:

**New on chain** (link **Trenches**) — live list of the 10 newest tokens: pad badge on the image, SYMBOL, name, age in green (`1s`…), MC (`$3.4K`). Rows link to trading. Refreshes every second.

**Portfolio PnL** card:
- Toggle **PnL** with a SOL/USD icon (aria "Display position in SOL/USD") → switches every $ figure on the page (both cards and calendar) to SOL; shared state.
- Period buttons **1D · 7D · 30D (default) · All** — relabel "30D Realized Profit" / "30D Total Volume" to the chosen period.
- Fields: Total PnL `$0.0 (+0.0%)`, Realized Profit, Unrealized, Total Volume, Holdings.
- **PNL Calendar**: `‹ Oct 2026 UTC+0 ›` month navigation, counters `0 / $0` (green, positive days / profit) and `0 / $0` (red), Mon–Sun grid, one button per day `YYYY-MM-DD: $0` (clicking a day did nothing visible with no data), footer "Current Positive Streak: 0d · Best Positive Streak in Oct: 0d".
- **Share PnL card** (share icon) → menu **This month / Last 7 days** → with no profit: toast "Share needs a positive month PnL".

**Latest launches** (toggle PnL SOL/USD, link **All** → `/sol/launch`): first row "New launch — Create a token on this chain $0.00" (button), then the user's launches (draft shows `??` avatar, `$TOKEN`, "Draft", `$0.00`), padded with placeholder rows `$TOKEN / Name / $0.00`.

**KOL signal** (link **Tracker** → Settings/KOL Tracker): tabs **TOP INTEREST** (default) / **LATEST**.
- Top interest rows: pad badge, SYMBOL, KOL names ("Limfork, Chester, Til"), SOL icon + total SOL bought (`42.5`), chip **3 KOLs**, age. Sorted by KOL count then SOL.
- Latest rows: SYMBOL, single KOL name + SOL, `Buy · 13s`.

**Rewards** card: pills **SOL fees** and **0.000 SOL pending**; text "Add a developer wallet to claim pad fees."; buttons **Portfolio** (`/sol/portfolio`) and **Referrals** (`/rewards?tab=referrals`).

---

## 2. Trenches `/sol/trenches` (shots `trenches-full.jpg`, `trenches-cards.jpg`, `trenches-filter.jpg`; DOM `trenches.html`, `trenches-filter.html`)

Three equal columns **New · Almost bonded · Migrated**, full height, each independently scrollable. **docs:** Hovering a column freezes the list order while metrics keep updating; mobile shows one column with tabs.

### 2.1 Column header (identical for the three columns, independent state)
- Title.
- **Keyword…** text input — instant client-side filter on symbol/name/address of that column.
- **Pause list moves** (pause icon, `aria-pressed`): tooltip "Pause — freeze list order". While paused it becomes **Resume list updates**, tooltip "Resume — show buffered cards", accent-filled, and shows the count of buffered new cards. Hovering the column also auto-pauses (same button flips to Resume).
- Quick-buy amount: SOL icon + input `placeholder 0`, `inputmode=decimal`, 52 px wide — the amount used by the **Buy** chips of this column; empty by default.
- **P1 · P2 · P3** segmented buttons (P1 active = accent text) — selects which trading preset (slippage/tip from Settings → Trading presets) the quick buy uses. The amount input is per column, not per preset.
- **Mute** (bell-slash) — mutes sounds/toasts for this column (no popover).
- **Filter** (funnel) → **Filter** dialog (see 2.3). **docs:** a blue dot on the funnel means the column differs from defaults.

### 2.2 Card anatomy (124 px min height, bottom border `line-50`, `role=link`, title "Open in trading")
Row 1: 56 px image (letter fallback) with pad badge (Pump.fun / LaunchLab / PumpSwap after migration; the badge is a link to the token website), truncated mint `7fVb…pump` (button **Copy address**, click copies without opening the card), **SYMBOL** (16 px) + name (14 px grey).
Row 2: age (green, `1s`), social icons (Website / Twitter / Telegram / Instagram / TikTok / "Twitter post"), then four counters with icons and **no tooltip**: `0` · `0` · `2/52` (yellow icon, white text) · `3`. The third is **dev migrated / dev launched** (same metric appears on the trading header as "Dev migrated tokens / tokens launched"); the others are KOL/smart-money style counts (not labelled in the UI — treat as holders-ish counters, verify before copying). Right side: quote capsule **SOL** (tooltip "Quote: SOL", xblue).
Row 3 audit capsules (12 px, `text-audit-good` green / `text-decrease` red / `text-yellow-100`; each has a `title`):
- "Top 10 holders" `13%`
- "Dev hold 13% · Fund age 19d" → shows `13%` + `19d` (or `DS 9d` = dev sold, fund age)
- "Insider / rat" `0%`
- "Bundlers 2 · hold 13%" `13%`
- "Phishing / entrapment" `13%`
- "Fresh wallets" `0%`
- "Sniper hold" `0%`
(A compact 4-capsule variant replaces the 7 on narrow columns.)
Row 4 (right block): **MC** `$4.4K` · **V** `$487.16` · **F** (SOL icon, "Total fees") `0.0006` · **N** `$8.3K` (net buy, hidden on narrow widths) · **TX** `2` with a buy/sell ratio bar (`bg-tx-buy` / `bg-decrease`), then the **⚡ Buy** chip (`data-testid=quickbuy`, accent text).
Whole card click → `/sol/trading/<mint>`; "Fee Split" link appears on tokens with pump.fun fee sharing.

### 2.3 Filter dialog (per column; tabs at top switch which column you edit)
Header **Filter** with ✕ and a **Reset filters** icon; tabs **New / Almost bonded / Migrated**.
- **Search Keywords** (`keyword1, keyword2...`) · **Exclude Keywords** · **Search X @Handle** (`handle1, handle2...`) · **Search Dev Wallet** (`wallet1, wallet2...`).
- **Launchpads** (`Select All`): Pump.fun · Mayhem · Bonk · StonkFun · LaunchLab · Bags · AGENCY · OTC (pill toggles, all on by default).
- **Quote Tokens** (`Unselect All`): SOL, USDC, then every xStock/RWA (AAPLx, AMZNx… TSLAx), ETH, PUMP, WBTC, hSOL, TRUMP, RAY, STONK, $WIF, Fartcoin … ~230 pills.
- Section tabs **Metrics** (default) / **Social** ("Social filters coming soon.").
- Metrics checkboxes (all on): **Dev Sell All · Dev Still Holding · Original Avatar · Dev Burnt**.
- Min/Max pairs (text inputs placeholder Min/Max, unit label): Time to bond (min) · Age (min) · Liquidity (K) · MKT Cap (K) · Volume (K) · Net Buy (K) · TXs · Buys · Sells · Total Fees (ETH label on this build) · Callouts · KOLs · Smart Money · X Followers · Dev Migrated · Dev Launched · Dev Migrated % (%) · Total Holders · Currently viewing · Top 10 Holding (%) · Dev Holding (%) · Insiders (%) · Phishing (%) · Fresh (%) · Snipers Hold (%) · Rug % (%).
- Footer: **Import/Export** (menu Import / Export JSON) · **Apply**.

### 2.4 Buy chip flow
With amount empty / no wallet: click does nothing visible (no toast). With a wallet + amount: sends a market buy of the column amount using preset Pn (slippage/tip from Trading Presets), using the wallet selected in the trading order rail ("First Wallet" / "With Balance" rule from Instant Trade). **requires a dev wallet** to observe the confirmation.

Keyboard: none observed on this page (Settings → Keybinds only covers launch tasks).

---

## 3. Trending `/sol/trending` (shot `trending-full.jpg`, DOM `trending.html`)

- Window tabs (`role=tab`): **1m (default) · 5m · 1h · 6h · 24h** — rename the Vol/TXs columns (`5m Vol`, `5m TXs`) and re-rank.
- Right of the tabs: **Filter** funnel (no popover opened on click — placeholder), quick-buy amount input `placeholder 0.0` (40 px) + **P1 · P2 · P3**.
- Table columns (buttons `Sort by …`): **Token / Age** · **MC** (+ 24 h % change under it, green/red) · **ATH MC** · **Liq** · **1m Vol** · **1m TXs** (total, then green buys / red sells) · **Holders** · **Total Fees** (SOL icon + number) · **Smart / KOLs** (two counters, tooltips "Smart wallets" / "KOLs") · **Token Info** · Buy.
- Sorting: 1st click = descending (header turns white, arrow icon), 2nd = ascending, 3rd = back to default momentum order.
- Token cell: image + pad link, SYMBOL, name, age (`28s`), truncated mint + Copy, social icons.
- Token Info cell = two rows of capsules with titles: "Top 10 holders" · "Dev hold" · "Insider hold" · "Bundler hold" · "Dex Unpaid"/"Dex Paid" (red `Unpaid` / blue `Paid`) ; "Phishing" · "Fresh wallets" · "Sniper hold" · "Wallets using trading terminals". Green = `text-audit-good`, red = `text-decrease`.
- **Buy** chip per row: same quick buy as Trenches (no-op without amount/wallet). Row click → trading. 124 rows loaded, live updates.

---

## 4. Launch

### 4.1 `/sol/launch` list (shots `launch-empty.jpg`, `launch-cto.jpg`; DOM `launch-cto.html`)
Left sidebar **Launches** (**Minimize sidebar** «, **Move sidebar to right**): search "Search...", buttons **+ New launch** (creates a draft and opens its workspace + Launch Token modal) and **CTO** ("CTO an existing token"), tabs **Draft / Launched** (Launched is the default tab; empty state "No launched tokens yet."). Draft rows: `??` avatar, name ("Untitled") + "No name yet", hover icons **Edit draft** (pencil) / **Delete draft** (trash). Main area empty state: "+ Create a new launch — Or choose one from your list in the sidebar.." + **New launch**.

**New CTO** dialog: "Run tasks on a token someone else deploys. Nothing is deployed. Add the address now or later — a token that isn't created yet is watched for 1 hour, and tasks with Auto start fire the moment it's created." Fields: **Token address (optional)** with radio **Token / Dev wallet** ("Address is a"), input "Paste a token / mint address, or add it later"; **Name (optional)** (maxlength 64, placeholder "New CTO — replaced by the token's name once it's known"); **Global Preset (optional)** select ("No preset — add tasks after"). Buttons **Cancel / Create CTO** (not clicked).

### 4.2 Workspace `/sol/launch/<id>` (shots `launch-workspace-draft.jpg`; DOM `launch-workspace.html`)
Grid of 4 draggable/resizable panels (**Workspace panels** gear → `PANELS: Activity ✓ Token info ✓ Chart ✓ Tasks ✓ · OVERLAYS: Trenches/Trending/X`). Each panel header is a drag handle "Move … panel" and has a resize handle; **Chart** has a trash icon "Delete chart panel" (removes it; restore via Workspace panels). Right rail "Launch options" (**Move options to left**).

**Chart** panel: "No chart yet — The chart will load after you launch." (after launch: same chart as Trading, timeframes 1s…1D, MC/Price).

**Token info** panel: image with bonding-curve ring ("Bonding curve 0.0%") + pad badge, name **Untitled token**, quote chip **SOL** ("Launch quoted in SOL"), **Edit draft** pencil → Launch Token modal; stats BOUGHT / SOLD / HOLDINGS / **PnL** (toggle USD/SOL) `$0 (—)`; rows Holdings `0.00%`, Bonding Curve `0.0%`, Market Cap `—`.

**Activity** panel: header **Filter** ("Filter activity by minimum transaction value") → popover `Minimum transaction: SOL minimum [ ] SOL · USD minimum $[ ] — Transactions must meet every minimum you set.` Tabs **Trades** · filter chips **All / KOL 0 / Others** ("Others (excl. your wallets) — available once a mint is known", toggle "Show others value in USD"), columns **Total** (Show USD) · **MC** · **Trader** ("Highlight own wallets as name chip") · **Age** ("Newest first — click for oldest"). Empty: "Trades appear once a mint is known".

**Tasks** panel header: segmented **SOL / %** ("Buy with SOL amounts" / "Buy with percent of SOL balance"), segmented **Balance / %** ("Sort wallets by token balance" / "by holding percent"), **Add Task ▾**, **Presets**.
- **Add Task** menu: **Bundle Task · Sniper Task · Volume Task · Buy Task · Wash Task** (each opens a setup dialog, see 4.4).
- **Presets** → dialog **Global Task Presets**: "Load replaces only the tasks on this launch. Launchpad, quote, buy amount, wallet, and fees stay as they are. Quick Launch still applies the saved snapshot." Section CURRENT TASKS (list or "No tasks yet"), select "Select global task preset" (No presets), buttons **Save as / Update / Delete preset / Close / Load preset** (all disabled while empty).
- Sub-header: gear **Trading preset settings** (see 4.5) · **P1 · P2 · P3** (P1 active) · `SLIPPAGE 30%` · `TIP (SOL) 0.0002` · **Hide details** chevron.
- **Dev** row: `▾ Dev ⓘ` (tooltip lists `Buy Amount: 1 SOL · Auto Sell: Off · Auto Dump: Off`), red **Dump All** ("Stop every task, then dump all tokens from all launch wallets") → with nothing to sell: toast "Dump All failed — No launch wallets to sell." Body: "Select a developer wallet for this launch to manage the dev task." After a wallet is set the row shows the dev wallet with sell buttons (**requires a dev wallet**).

### 4.3 Right rail (icons with labels)
- **Launch** → without dev wallet: toast "Select a developer wallet first". With one: launches the saved draft (**requires a dev wallet**).
- **Pay Dex** → dialog **DEX Screener Profile**: "Launch the token before paying for a profile." / Cancel.
- **Lock Tokens** → dialog: "Time-lock this launch's token on Streamflow. The wallet you pick is the recipient — after unlock it can withdraw. Locks cannot be cancelled." + "Launch the token before locking." Buttons Cancel / **Lock on Streamflow** (disabled).
- **Global Fees** ("Configure Global Fees") → popover (DOM `launch-rail-globalfees.html`, shot): title **Global Fees**, link-button **How it works** → reveals "When enabled, increases global fees on the token."; checkbox **Enable Global Fees** (off). **docs:** "Raise fees on trading terminals".
- **Burn Tokens** → dialog: "Permanently destroy this launch's token from selected wallets. Enter a token amount per wallet. This cannot be undone." + "Launch the token before burning." `0 selected`, Cancel / **Burn** (disabled).
- **Claim Rewards** → toast "Select a developer wallet first".

### 4.4 Task setup dialogs (opened from Add Task; nothing was added)
Common header: title, preset bar `Load task preset ▾ (No presets) · Save as preset · Update · Delete`, Close. Common **Wallets** block: segmented **Amount / Slider** (per-wallet SOL input vs slider), wallet groups list ("No wallet groups yet. Create groups in Portfolio to use them here."), footer Cancel / **Add … Task** (disabled until valid).
- **Bundle Task Setup**: note "At most 4 wallets — each buys in its own transaction so they show as different buyers." Section **Bundle calculator — Pump.fun curve**: table `# | BUYER | SOL | SUPPLY` with `1 | Dev buy | 1 | 3.42%` and total `Dev + bundle | 1 | 3.42%`, "Buys land in this order in one bundle, after fees." Toggle **Sell all on external** — "Sell 100% of bundle wallets when net external SOL hits the threshold" + SOL input (disabled until on). **docs:** one Bundle per launch; runs with the create tx, no start/pause/stop; warns when a buy exceeds a wallet balance.
- **Sniper Task Setup**: **Timing & execution** "Delay between wallet buys · 0 = all instant": Min delay `0` sec, Max delay `1`→`0` sec (number inputs), **Slippage %** `30` (placeholder 20), **Tip (SOL)** `0.0002`, **Retry** `On` + Max retries `1` (disabled when retry off), toggle **Stop on activity** "Cancel this task when net external volume hits the threshold" + SOL input.
- **Volume Task Setup**: **Execution**: **Mode** `Buy only / Sell only / Buy + Sell`, **Min (s)** `0`, **Max (s)** `1`, **Min (SOL)** `0.1`, **Max (SOL)** `0.2`, **Slippage %** `20`, **Tip (SOL)** `0.0002`, toggle **Auto-Start**, **Duration Limit (min)** (empty), **Max Trades per Wallet** (empty), toggle **Stop on activity** + SOL.
- **Buy Task Setup**: **Min (s)** `0`, **Max (s)** `0`, **Slippage %** `20`, **Tip (SOL)** `0.0002`, toggle **Auto-Start** "Fire buys as soon as the token mint is known at launch", toggle **Stop on activity** + SOL.
- **Wash Task Setup**: `1. Source wallets` ("0 marked" — "Pick a dev wallet or add a Bundle or Sniper task first. Their wallets show up here."), `2. Wash wallets` — **Per source** `1 / 2 / 3`, select **Auto-pair from** (`Any wallet` / groups) + **Auto-pair** button, "Mark source wallets above to pair them.", `3. Delay between pairs` "Random, in seconds. 0 = no delay." Min / Max (`0`, `0`). **docs:** source sells its balance, SOL goes to wash wallets, they buy back; multiple wash wallets split evenly; a short wallet makes that pair fail while the rest run; card has Start / Stop / Sell All / Edit.

### 4.5 Trading Presets dialog (gear in Tasks panel, also Instant Trade gear; DOM `launch-trading-presets.html`)
Tabs **Buy Settings / Sell Settings / Buttons Presets**.
- Buy Settings — **Native amounts**: P1 `0.1 0.15 0.22 0.5`, P2 `0.2 0.35 0.5 1`, P3 `0.5 1 2 5`; **Percent of native balance**: P1 `10% 25% 50% 100%`, P2 `15% 30% 50% 75%`, P3 `25% 50% 75% 100%`.
- Sell Settings — percent rows: P1 `5% 10% 20% 50%`, P2 `10% 25% 50% 75%`, P3 `25% 50% 75% 100%`.
- Always visible below: **Trading Presets** table `Slippage % / Tip (SOL)` per P1/P2/P3 = `30 / 0.0002` each; **Multi wallet trading** (collapsible): **Buys value spread** slider 0–100 % step 1 ("Randomizes each wallet buy around the average. Total still matches your input amount.") default 0 %; **Buys delay** slider 0–1 s step 0.1 ("Seconds to wait between each wallet buy when using multi-wallet buy.") default 0.0 s.

### 4.6 Launch Token modal (Edit draft / New launch; shots `launch-token-modal.jpg`, `launch-token-modal-cloned.jpg`; DOM `launch-token-modal.html`)
Header: **Launch Token** · **Clone** (title "Clone metadata") · **No wallet ▾** ("Select developer wallet") · trash **Clear form** · ✕ **Save and close**. Closing with ✕ or **Escape autosaves the draft** (the sidebar/Token info rename immediately). A first-run coach mark "Pick the launch chain here — Got it" points at the pad chips.
Fields (ids): `launch-token-name` "Token name" · `launch-token-symbol` "Symbol" with case buttons **AB / ab / Ab** (Uppercase/Lowercase/Capitalize — disabled while symbol empty) · `launch-token-description` textarea · `launch-website` (type url) · **X (Twitter)** `launch-post` with **Post** button · `launch-telegram`.
- **Post** → floating X composer: "Connect X account", "up to 4 images", **Use token image**, counter `25000`, **Save** — tweet sent when the token goes live (**docs:** Post to X / Post & Launch).
- **Select Image**: drop zone "Drag & drop an image here, or Ctrl+V", buttons **Upload** (file input) · **Paste** · **ASCII** ("Create an ASCII art image from the symbol") → dialog **ASCII token image**: textarea prefilled with the symbol ("Enter for a new line"), Characters `░▒▓█ Blocks / .:+#@ Classic / ### Hash / ABC Symbol / 010 Binary`, 7 colour presets + Text colour `#39ff14` + Background `#050805`, **Detail** slider 40, toggles **Glow / Background texture**, Cancel / **Use image**. After an image is set: **Crop** and **Remove** buttons appear.
- **Clone** → dialog "Clone token metadata — Paste a contract address — name, symbol, image, and socials." input `So1…`, Cancel / **Clone** (enabled once an address is typed). With `Fa8zSs7LGmYtxqpn7o3sqk9kCbhrAEvtWoER1zHDsZem`: toast **"Cloned from Pump.fun"**, fills Name `Clanker`, Symbol `Clanker`, Website `https://www.agencypad.fun/coin/Fa8z…`, X `https://x.com/clankercoinwww`, image (data URL JPEG); description/telegram stay empty if the source has none; launchpad chip is **not** changed.
- **Launchpad chips** (single select, pump.fun default): **Pump.fun · Bonk · StonkFun · Bags · AGENCY · OTC**. Chip changes the rows beneath:
  - Pump.fun: option chips **Holder rewards · Off-chain · UsePaid · Fee sharing** (checkbox + button each) + mint row **# Fetch mint address** "Reserves a …pump address from the pool" + **Import** ("Import your own mint keypair" → inline `Mint private key` password field "Base58 secret key or [1,2,3,…]", **Use mint**, note "The mint keypair is stored server-side and signs the create transaction — this launch will use its address instead of a pool address.").
  - Bonk: no option chips; "Reserves a …bonk address from the pool"; Quote select offers SOL / USD1.
  - StonkFun: chip **Standard** (checked); **Get mint address** "Reserves a mint address for this launch"; quote defaults to an xStock (AMZNX).
  - Bags: chips **Default (2%) · Fee sharing**.
  - AGENCY: chip **Enable AI influencer** ("A character that posts videos and photos on X. Leave this off to launch without one.") + model **Claude Sonnet 5.5**.
  - OTC: **Reward asset** "70% of fees buy this for holders — Choose reward asset — Single asset or an ETF basket of 2–10 assets"; Holder rewards/Off-chain/UsePaid disabled.
- Option chip tooltips (pump.fun): **Holder rewards** "Set the creator fee aside for the coin's holders instead of a creator wallet — pump.fun pays them out. Permanent, and cannot combine with fee sharing or a charity." (checking it shows the same explanation inline). **Off-chain** "Reserve the mint for free. The first buy creates the Pump pair on-chain and pays rent." **UsePaid** "Route all creator fees to the usepaid.app treasury, which pays 80% of them to an X account through X Money and burns $PAID with the rest. Replaces the other launch modes." **Fee sharing** → dialog **Fee Sharing 0/10 · 100%**: "Split creator fees with wallets, GitHub users, and/or charities after launch. GitHub recipients claim on Pump.fun." rows `% | Wallet address`, add buttons **Wallet / GitHub / Charity**, **Split** (equalise), Clear, Cancel, **Apply** (max 10 recipients, must sum to 100 %).
- Toggles (switches): **Global Fee** ("Increases global fee by this amount on launch") → reveals input placeholder `0.001` SOL; **Auto Dump** ("Dump all wallets when net external volume reaches this SOL amount") → reveals SOL input `0`; **Auto Dev Sell** ("Sell 100% of the developer wallet this many milliseconds after the token goes live") → reveals segmented **MS / MC** + input placeholder `1000` ms.
- **Buy Amount** `1` SOL (`launch-buy-amount`) with live hint "3.42% supply" ("Share of total supply this dev buy gets on the bonding curve"; 2 SOL → 6.63 %).
- **Quote** button `SOL ▾` → searchable list ("Search quote token"): Solana, USDC, every xStock (AAPLx, AMC, AMZNx, AVGOx, BA, BABA, BOT, BRK.Bx, BULL, COINx, COST, CRCLx, DELL, DJT, DRAM, ETH…).
- **Select developer wallet** dropdown: "Create new developer wallet", "No wallets above 0.01 SOL", checkbox **Hide under 0.01 SOL** (on).
- **Save** (accent, full width) — saves the draft and closes (not clicked).
- **Clear form** empties every field, image, chips and toggles (buy amount back to 1).

---

## 5. Portfolio `/sol/portfolio` (shots `portfolio-full.jpg`, `portfolio-consolidate-view.jpg`, `portfolio-disperse.jpg`, `portfolio-mixer.jpg`; DOM `portfolio.html`, `portfolio-groups.html`, `portfolio-create-wallets.html`, `portfolio-import-wallets.html`, `portfolio-deposit.html`, `portfolio-disperse.html`, `portfolio-mixer.html`)

Layout: left 2/3 = wallet list (top) + Activity (bottom, draggable separator "Resize wallet list and activity"); right 1/3 = summary panel (separator "Resize wallet summary").

### 5.1 Tabs
- **Developer Wallets**: toolbar **Export Keys · Move · Archive · Delete** (disabled until a row is checked) · **Import** · **+ Create Wallets** (also in a **Wallet actions** kebab menu). Search "Search address or name". Sub-tabs **All (0) · Archived · Deleted**. Table: Select All checkbox, columns `SOL Bal`, **Sort by SOL**, **Vol**, **Tokens**, SOL, Vol. Empty: "No developer wallets yet. Create one to manage launches."
- **Groups**: toolbar Import · Create Wallets · **New Group**; sub-tabs **Archived (0) · Deleted (0)**; table "No wallets in this group yet."; summary heading becomes **Groups (0)**.
- **Marketplace** (Solana only): tiers **Normal** (`4273 available · 0.05 SOL/wallet`) · **CEX-funded** (`117 available · 0.1 SOL/wallet`, extra column Exchange: Changelly / Whitebit / Ccecash) · **Migration Boost**. Table `Batch (date) | Available | Qty` with −/+ stepper (min 0, max = available) and **Max**; **Refresh inventory**; footer `Selected 0 · 0 SOL` + **Continue** (disabled at 0). Summary panel text: "Platform inventory — Buy premade Normal funded wallets or CEX-funded wallets. Normal 0.05 SOL · CEX-funded 0.1 SOL. All wallets are at least 24h old. Clear from Bubblemaps and without fresh wallet leaf." Migration Boost: segmented **Standard · $150k / Subscriber · $1M**, "Pick a previous launch or clone a mint. Creates at ~$150k MC, then migrates for dust. ~0.08 SOL per boost.", **Payer wallet · receives migrated tokens** (No wallets), rows `Boost 1 — Previous launched token / Clone metadata`, **Add boost**, "Est. ~0.080 SOL for 1 boosts", Start.

### 5.2 Create / Import
- **Create Wallets** dialog: **Label prefix (optional)** (placeholder `Wallet`; "Numbered labels (e.g. Sniper 1, Sniper 2)."), **Number of wallets** stepper 1–50 + **Max** ("Generate up to 50 new developer wallets at once."), Cancel / **Create 1** (submit).
- **Import Wallets** dialog: **Label prefix** (placeholder `Imported`), **Private keys** textarea ("One key per line or separated by commas. Up to 50 keys."), Cancel / **Import 0** (count updates, disabled at 0).

### 5.3 Summary panel (right)
Heading **Developer Wallets (0)** · periods **1D 7D 30D(default) All** · **PNL Calendar** → dialog identical to the dashboard calendar (Previous month, Next month disabled in the current month, Share PnL card, "Close realized PnL history").
**Total Balance** `0 $0` (toggle "Display total balance in USDC/SOL"), **30D Total Volume** `—`, **30D Realized Profit** `—`, **Total PnL** (toggle USD/SOL) `—`, **Unrealized Profits** `—`.
Action grid (all open a right-side **drawer**, "Close drawer"):
- **Deposit** → "No wallets available — Create or import a wallet to receive deposits." (with wallets: address + QR).
- **Withdraw** → "Create or import a wallet to withdraw funds."
- **Unwrap** → **Unwrap WSOL**: "Convert WSOL back to native SOL in the selected wallet. Requires a small amount of SOL for gas."
- **Consolidate / Distribute / Transfer** → not a drawer: the summary panel turns into a **transfer view** with two drop zones **Source Wallet** ("Drag wallets here to Consolidate") and **Target Wallet**, buttons **Reset · Switch** (swap source/target) · ✕ ("Close transfer view") · **Start Consolidate / Start Distribute / Start Transfer** (disabled until both zones filled). Wallet rows are dragged from the list.
- **Convert** → drawer "Add a Solana wallet to convert." (SOL ⇄ USDC etc.).
- **Swap Stocks** → **Swap Stocks → SOL**: "Sell tokenized stocks and RWA in selected wallets to native SOL via Jupiter. If an on-chain swap needs SOL for fees and the selected wallet has none, another of your wallets supplies a small amount." list "Loading stock holdings…", **Review SOL quote** (disabled).
**Privacy funding**:
- **Disperse** → drawer **Disperse · Developer Wallets** (+ **History** button): **Preset** select / Save as / Update / Delete; **Total to split (SOL)** input `0.0` + **Split equal**; **Variation** slider 0–100 % with shuffle icon and quick buttons `0% 25% 50% 75% 100%` ("0% is an equal split. Drag to vary amounts across wallets while still summing to the total. You can still edit any row."); **Delay between wallets (minutes)** `0`; **Destinations (0/0)** list with per-row amount + **Clear**; **Deposit total 0 SOL**; CTA **Create deposit wallet** (a fresh deposit wallet is generated, you fund it, then it disperses).
- **Reverse Disperse** → drawer: **Recipient** segmented **Address / Select wallet** + "Solana address" input; wallet list `0/0 selected · 0 SOL` + Clear; **Delay (min)** `0` "between wallets (0 = ASAP)"; **Start Reverse Disperse**.
- **Mixer** → drawer **Mixer · Developer Wallets** (+ History): **Service** segmented **Husher (default) / SplitNOW**; **Total to mix (SOL)** `0.05` + Split equal; note "Min 0.05 SOL · sol · splits across selected wallets"; **Destinations (0/0)** + Clear; **Deposit total 0 SOL**; **Fetch Quote** (disabled).

### 5.4 Activity (bottom)
Tabs **Activity** (accent) then sub-tabs **Disperse / Reverse Disperse / Mixer** with empty states "No disperse tasks yet. Use Disperse in the summary panel to start one." / "No reverse disperse tasks yet…" / "No mixer orders yet. Use Mixer in Privacy funding to start one." **docs:** Holdings and Activity sections appear once wallets exist.

---

## 6. Rewards `/rewards` (shots `rewards-empty.jpg`, `rewards-pumpfun.jpg`, `rewards-referrals.jpg`; DOM `rewards-pumpfun.html`)

Tabs **Fees / Referrals** (`?tab=referrals`).
**Fees**: launchpad chips **Pump.fun · Bonk · Bags · Reward tokens**; before choosing: card "Choose a launchpad — Select one above to scan your managed wallets and view available rewards".
- After **Pump.fun**: segmented **Developer / Archived / Deleted** (right); section **Claim**: card **Creator fees** with pills `+0.000 SOL` `+0.000 USDC` and button **Nothing to claim** (disabled; becomes **Claim all**), card **Pump.fun rewards** "Scans your active DEV wallets for Pump.fun creator fees."; section **Activity → Claimable rewards (0 items)** "No claimable fees for this wallet yet." + link **Launch a token**.
- **Bonk**: same, pills SOL / USD1, cards "After graduation — Once a coin graduates, creator fees go to this wallet automatically." and "Claim creator fees — Claim available fees into this wallet as SOL and USD1."
- **Reward tokens**: "What counts — Tokens your reward claims paid out — xStocks, USDC, OTC payouts, and custom quotes you launched against — worth $1 or more, across all your wallets. Convert sells them for SOL. Your own coins are never touched." Buttons **Convert rewards to SOL** / **Nothing to convert**, lists **By token** and **Balances** ("Scanned 2s ago", **Rescan**).
- **docs:** "Fund claim fees" tops up wallets short on gas; Groups tab shows Pump.fun cashback on group wallets; EVM only tracks launches made on Block X.
**Referrals**: avatar, name, **20% Referral Rate**, `0 referred`, rank **Bronze**; claim rows `0 SOL Claim · 0 BNB Claim · 0 ETH Claim` ("$5 min per chain. Paid in native SOL, BNB, or ETH from the payout vault."); code input `/@ yourname` + **Set code** + **Share referral** (both disabled until a code exists; "Choose a code once, then share /@yourcode."); progress "Next level: Silver · 25% — $100K more referred volume to reach Silver"; tabs **Activity** ("No referrals yet. Share your invite link to get started.") / **Payouts** ("No claims yet. Accrued balances appear above after referred traders pay fees or subscribe."). **How it works** dialog: Bronze 20 % (start) · Silver 25 % ($100,000 referred volume) · Gold 30 % ($500,000) · Diamond 40 % ($2,000,000); share = percent of collected platform fees and paid subscriptions of referred users; each chain needs ≥ $5 to claim.

---

## 7. Subscription `/subscription` (shot `subscription.jpg`)
Tabs **Plans / Payments**; top-right **How it works** + badge `FREE · 0.8% effective fee`.
Cards: **Free** (ACTIVE) `$0` — 0.8 % Starter platform fee · Pay fees as activity is processed · All supported chains and launchpads. **Subscription** `$1,500 / 30 days` — 0 % platform fee while active · Account-wide across every chain · Pay by QR, copied address, or managed wallet · **Subscribe** (not clicked; **docs** still say $800).
**30-day volume fee** bar: "Completed buys and sells across every chain and launchpad" `$0 · Starter · 0.8%` · "Trade $10,000 more to reach Growth (0.7%)" · "0.8% applies to the next trade".
How it works: tiers **Starter 0.8 %** → **Growth 0.7 %** ($10,000) → **Scale 0.6 %** ($50,000) → **Pro 0.5 %** ($250,000) → **Elite 0.4 %** ($1,000,000) 30-day volume; "The current trade is priced before it is counted, so it only affects the next trade." Subscriber trades still count.
**Payments**: "Saved payer wallets 0 — A payer wallet is saved after checkout." · **Invoices** table `CREATED / CHAIN · ASSET / AMOUNT / PAYER / STATUS / TRANSACTION`.

---

## 8. Tools `/tools` (shots `tools-close-spl.jpg`, `tools-vanity.jpg`)
Chips **Close SPL accounts / Warmup / Vanity Generator** (`?tool=vanity`).
- **Close empty SPL accounts**: "Scan selected wallets, then close empty Token and Token-2022 accounts. Without a fee payer, rent returns to the same wallet. Accounts with a remaining token balance are skipped." Scope chips **All / Developer / Groups / Archived / Deleted**, **Scan**, **Close empty accounts**; select **Fee payer / receive** (`Each wallet (needs SOL)` or a funded wallet — "Pick a funded wallet to pay fees and receive rent for every close."); `0 wallets selected` / **Select all**.
- **Warmup**: "Pump.fun buy/sell loops to age wallets" — **New warmup** → task list ("No warmup tasks — Start one to run buy/sell loops on live feed tokens.").
- **Vanity Generator**: "Keys are generated locally in this browser tab. Longer patterns take much longer." **Prefix** (`e.g. ABC`), **Suffix** (`e.g. pump`), example preview, **Case sensitive** No/Yes, **Threads** 1–8 (default 8), **Reset / Generate**; panel **Generation info**: Difficulty, Generated, Estimated time, Speed, Status, Progress; "Saving imports the key as a managed developer wallet."

---

## 9. Settings `/sol/settings` (shots `settings-appearance.jpg`, `settings-keybinds.jpg`; DOM `settings.html`, `settings-keybinds.html`)
Left rail: search "Search settings..." + group **APP**: Appearance · Workspace · Notifications · Keybinds · KOL Tracker · Account.
- **Appearance**: THEME grid (Block X · GMGN · GMGN Old · Light · Pink · Axiom · Photon · BullX · Hyper · Custom — preview swatches), TYPOGRAPHY **Font** select (Geist (Default) · Inter · IBM Plex Sans · DM Sans · Space Grotesk · System UI), BACKUP **Import custom theme / Export custom theme**.
- **Workspace**: LAYOUT — **Workspace UI** `UI 1 / UI 2`; **Launch sidebar** `Left / Right`; **Sidebar starts collapsed** (off); **Launch options panel** `Left / Right`. WALLETS — **Highlight high holdings** (on) "Flag wallet rows when a wallet holds more than the threshold % of total supply", **Highlight threshold** `3` %; **Accent holdings above 0%** (on); **Wallet PnL %** (off). ACTIVITY — **Own trades color** picker `#0052ff` + hex + Reset. TOKEN LINKS — **Trading terminal** `Axiom / GMGN / Terminal` ("Falls back to Axiom on chains the terminal doesn't support"). RESET — **Reset panel layouts · Clear remembered inputs · Reset all workspace prefs** ("Remembered inputs clear last buy amount, trading token, and developer wallet.").
- **Notifications**: **Show notifications** (on; "same control as the footer bell"), **Toast Position** `Top Left · Top Center · Top Right · Bottom Left · Bottom Center · Bottom Right`.
- **Keybinds** (verbatim, all `None` by default; "Click a keybind to record a new shortcut. Press Escape to cancel."; each row has a key button, ✕ clear, ↺ reset):
  - **Keyboard shortcuts** — Enabled — shortcuts are ignored while typing (switch).
  - LAUNCH: **Dump All** — Sell 100% of the launch token from every project wallet.
  - DEV TASK: **Dev — Sell 100%** — Sell 100% of the launch token from the developer wallet. **Dev — Sell custom %** — Sell the custom % set below from the developer wallet (Sell % `50`).
  - BUY TASKS: **Buy Task 1 — Start / Pause** (Toggle Start/Pause/Resume for the 1st buy task in the Tasks panel) · **Buy Task 1 — Stop** · Buy Task 2 — Start / Pause · Buy Task 2 — Stop · Buy Task 3 — Start / Pause · Buy Task 3 — Stop.
  - VOLUME TASKS: Volume Task 1/2/3 — Start / Pause and — Stop (same wording with "volume task").
  - **Reset all to defaults**.
- **KOL Tracker**: "Crypto influencer wallets (Solana and EVM)". **KOL buy sound** (off) "Play an alert when a tracked KOL buys in the token activity feed." — Alert 1…25 picker, **Test**, **Volume** slider 50 %. Tabs **Solana (111) / EVM (1100)**, **Import** (GMGN/Axiom JSON or paste), **Reset to default**, filter **All / Disabled (0)**, **Select all / Clear / Disable / Enable / Delete** (bulk), list rows `name · truncated wallet · Disable`. Note: "Import GMGN/Axiom JSON, multi-select to Disable/Enable/Delete. Duplicates keep the imported name. Reset restores the built-in list."
- **Account**: PROFILE `DarkGPT @darkgpt_officiel`, SIGN-IN METHOD `Discord`, PLAN `Free — 0.8% effective fee · Starter` + **Manage** (→ Subscription).

---

## 10. Trading `/sol/trading/<mint>` (shots `trading-full.jpg`, `trading-instant-trade.jpg`; DOM `trading.html`, `trading-buy-panel.html`)
Observed on `91r5Bn9Qda5RHFRuUWLjrpum6Ur8CHuAvfdyVEfhV84S` (ELON, migrated).

**Header**: image with bonding-curve ring ("Bonding curve 100.0%") + pad link **View on Pump.fun**; **ELON** Elon · copy button + `91r5…V84S` (click copies) · links **Fee Split** (pump.fun) · **Explorer** (solscan) · **Open on Axiom** (terminal chosen in Settings); age `3m`; capsules **DS 9d** ("Dev sold · Fund age 9d") and **2/2** ("Dev migrated tokens / tokens launched"); stats **MC $23.54K · Price $0.0₄240 · Liq $10.8K · 24h Vol $563.9K · Total Fees 30.777 · Total supply 980.3M · B. Curve 100.0% · Total Tax 1.25% / 1.25%** (buy/sell).

**Chart**: timeframe buttons **1s 5s 15s 1m 5m 15m 1h 4h 1D**, toggle **MC / Price** (MC default), candlestick with current-price label; `table` role for a11y.

**Trades** panel (separator "Resize trades panel"): tabs **Trades / KOL Signals** ("No tracked KOL buys for this token yet — Signals stream here live when a tracked wallet buys."). Filter chips **All · KOL 0 · Others −30.751** (tooltip "Others (excl. your wallets): 1041 buys 352.086 · 961 sells 382.837 · net −30.751", button "Show others value in USD"); **Collapse filter tags**. Columns **Total** (SOL, "Show USD" toggle) · **MC** at trade time · **Trader** (4-char suffix, link `#<wallet>` filters by trader, terminal badge FOMO / Axiom / GMGN / Padre, "Highlight own wallets as name chip — click for whole row") · **Age** ("Newest first — click for oldest"). Rows green/red by side, each links to solscan tx; "Scroll for older trades".

**Right column**:
- Window stats: buttons **5m +25.9% · 1h +236.5% · 6h +553.0% · 24h +553.0%** (click selects the window) → below: **Vol $6K · Buys $3K · Sells $2K · Net Vol. +$1K** (24h: `Buys 5.4K / $289K`).
- **Managed wallet order rail**: segmented **Buy / Sell** (Buy accent, Sell red), **Minimize order rail**; order types **Market** (active) · **Limit** (disabled, "Limit orders coming soon") · **Adv.** (disabled, "Adv. orders coming soon"); wallet selector button `0 ◦ 0.000` ("0 wallets selected, 0.000 SOL", opens `order-rail-wallet-drawer`); text "Create a managed wallet in Portfolio to trade."; footer **Bought $0 · Sold $0 · Holding $0 · PnL $0 (—)** (toggle SOL/USD). With wallets: amount presets P1–P3 and slippage/tip appear here (**requires a dev wallet**).
- **Token Info** (collapsible): **Entry risk** `High · 40.7%` with bar; grid **Top 10 H. 24.9% · Dev H. 0.0% · Snipers H. 0.0% · Insiders 0.0% · Bundlers 12.2% · Phishing 3.6% · Holders 382 · Fresh 10.7% · Rug Ratio 100.0%** (green `text-increase` = good, red `text-decrease` = bad; no tooltips); **Launchpad** `pumpfun`, **Pool** address.

**Bottom**: tabs **Positions** ("Sign in and add a managed wallet to track positions.") / **Wallets** ("No managed wallets available.") + button **⚡ Instant Trade** → floating panel (draggable "Move Instant Trade", gear **Instant Trade settings** = Trading Presets dialog, pencil **Quick edit trading buttons**, ✕): **P1 P2 P3** · wallet count `0`; **Buy** block (balance `0.000`): 8 round buttons `0.1 0.15 0.22 0.5 / 0.4 0.7 1.5 2` (disabled without wallet), `30% · 0.0002` (slippage/tip); **Sell** block (`0 ELON`): `5% 10% 20% 50% / 40% 50% 75% 100%`, `30% · 0.0002`; PnL strip `$0 $0 $0 $0` (toggle SOL); wallet rule **First Wallet / With Balance**, **Wallet trading settings** gear. Mobile layout adds a bottom nav **Trades / Trade / Position**.

---

## 11. Flows that require a developer wallet (not observed)
Rail **Launch** and **Claim Rewards** (toast "Select a developer wallet first"); Dev row controls (sell buttons, auto sell); Dump All real confirm; task **Add … Task** submit and task cards (Start/Pause/Stop/Edit/Sell All); Quick Launch execution; Portfolio **Deposit** (QR), **Withdraw**, **Unwrap**, **Convert**, **Swap Stocks** quote, **Export Keys / Move / Archive / Delete**, **Consolidate/Distribute/Transfer** start, Disperse **Create deposit wallet**, Mixer **Fetch Quote**, Reverse Disperse start; Marketplace **Continue** checkout; Rewards **Claim all** / Fund claim fees; order rail presets + wallet drawer; Instant Trade buttons; Trenches/Trending **Buy** chip result; Settings keybind recording (not exercised).
