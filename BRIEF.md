# TRENCH — brief de construction (privé, usage local, un seul utilisateur)

Remake privé de Block X (blockx.gg) : terminal Solana pump.fun « Launch · Trade · Trench ».
Pas de login, pas de pricing, pas de referral. Les clés privées restent sur la machine
(keystore chiffré dans `%LOCALAPPDATA%\trench\keystore.enc.json`, jamais dans le repo).

Stack : Next 16.3 (App Router, Turbopack, `src/`), React 19, Tailwind 4, TypeScript.
Port dev **3985** (`npm run dev`). Lire `node_modules/next/dist/docs/01-app/**` avant de coder
(route handlers, `after()`, caching). Règles lint React 19 : pas de `setState` dans un effet,
`useSyncExternalStore` pour les stores externes, refs pour les valeurs mutables.

## Moteur réutilisé (déjà copié, NE PAS réécrire)

`src/engine/solana/**` + `src/engine/keystore.js` = moteur pump.fun de donchain.snipe
(JS ESM, dépend seulement de `@solana/web3.js` 1.98 et des builtins Node). Exports clés :
- `pump/launch.js` : `prepareLaunch`, `executeLaunch`, `launchBundle` (Jito), `launchStaggered`, `snipeMint`, `sellMint`
- `pump/instructions.js` : `buyInstruction`, `sellInstruction`, `collectCreatorFeeInstruction`
- `pump/math.js` : `planBuys`, `planSells`, `buildBuyTx`, `buildSellTx`, `solOutForTokens`, `tipInstruction`
- `pump/positions.js` : `readPositions`, `curveTradeHistory`, `parseBondingCurve`
- `pump/metadata.js` : `uploadPumpMetadata` (IPFS pump.fun), `parseMintMetadata`, `ipfsToHttp`
- `pump/fees.js` : `readPumpCreatorFees`, `claimPumpCreatorFees`
- `fund.js` : `distributeSol`, `sweepSol` ; `send.js` : `sendAndConfirm`, `sendMany`, `submitJitoBundle`, `sendBundleAndConfirm`
- `state.js` : `SolanaState` (wallets, keypairs, rows, config, connection()) ; `keys.js` : `parseSolanaKey`, `base58Encode`
- `config.js` : `SOLANA_PUBLIC_RPC`, `JITO_TIP_ACCOUNTS`, `normalizeSolanaRpc`
- `keystore.js` : `saveKeystore(path, passphrase, lines)`, `loadKeystore(path, passphrase)`, `keystoreExists`, `assertStrongPassphrase`
Les handlers d'origine sont lisibles dans `C:/Users/wowo2/Desktop/secret/donchain.snipe/src/server.js`
(`/api/sol/launch` l.2369, snipe l.2519, buy l.2553, sell l.2595, positions l.2870, wallets/generate l.2048) :
s'en servir pour les signatures et l'ordre des arguments, ne pas copier le serveur.
Le code moteur est minifié-puis-reformaté : l'appeler, ne pas le retoucher sauf bug prouvé.

## DA — PAS celle de Block X : claire, sobre, lisible (demande explicite du 2026-10-04)

Il veut « une autre DA, plus simple à comprendre ». Donc : **thème clair**, aérée, un seul accent, libellés en
toutes lettres, une phrase d'explication en tête de chaque page. Pas de capsules cryptiques « MC V F N ».

```
Fond page #f5f6f8 · cartes #ffffff bordure 1px #e5e7eb rayon 12px ombre très légère · navbar #ffffff
Texte #0f172a (principal) · #475569 (secondaire) · #94a3b8 (libellés 11px uppercase tracking-wide)
Accent #16a34a (vert pump, boutons principaux, BUY, hausse) · hover #15803d · fond accent #16a34a14
Danger #dc2626 (SELL, baisse, dump) · Avertissement #d97706 (keystore verrouillé, auto-dump armé) · Info #2563eb (liens)
Inputs #ffffff bordure #d1d5db, focus ring accent · Chips #f1f5f9 · Barres de progression accent sur #e5e7eb
Police : Inter (next/font/google) ; chiffres, mints et signatures en JetBrains Mono.
Densité : padding 16px, lignes de 40px dans les listes, titres de page 20px semibold, sous-titre 14px secondaire.
```
Chaque chiffre a son libellé complet : « Market cap », « Volume 5 min », « Bonded 62 % », « Trades », « Age ».
Captures de Block X dans `design/refs/` = référence de STRUCTURE (3 colonnes, panneau buy/sell) pas de style.
Nom affiché : **TRENCH** (wordmark texte, poids 700, point vert après le nom).

Navbar (56px, blanc, bordure basse) : TRENCH · **Wallets** · **Launch** · **Dev room** · **Trenches** · Settings |
à droite : wallet actif (label + solde SOL), état du flux (point vert « live » / gris « offline »), prix SOL.
L'ordre de la navbar = le flux du dev : financer ses wallets → lancer → piloter son token → regarder les trenches.

## Pages

### /trenches (`/` redirige vers `/portfolio` si aucun wallet, sinon `/dev`)
3 colonnes pleine hauteur : **New** · **Almost bonded** · **Migrated**. Chaque colonne : barre (recherche
mot-clé, bouton filtres, presets P1/P2/P3 en SOL éditables, mute). Liste scrollable de cartes ; hover sur une
colonne = gèle l'ordre (les chiffres continuent). Carte (voir capture) : image 56px, SYMBOL + nom, âge (vert),
mint tronqué `pump…9Dfn` copiable, puis capsules : **MC** (USD), **V** volume SOL, **TX** nb trades,
**F** fees SOL (si connu), progress de bonding (barre bleue, %), holders top 10 % / dev % / bundle %
si calculable sinon capsule absente (pas de valeur inventée), bouton **⚡ 0.1 SOL** = quick buy au preset P1
avec le wallet actif (confirmation inline 1 clic). Clic sur la carte → `/trade/[mint]`.
Mobile : une colonne à la fois avec un segmented control.

### /trade/[mint]
Gauche : en-tête token (image, nom, symbol, mint, liens pump.fun/solscan, créateur, âge), graphique
lightweight-charts en chandelles 1s/15s/1m construit depuis `curveTradeHistory` + flux live ; sous le graphique
l'onglet Trades (liste live), Holders (top 20 via RPC `getTokenLargestAccounts`), Positions (mes wallets).
Droite : panneau Buy / Sell : choix wallet(s) (wallet actif ou multi-sélection), montant SOL (presets P1-P3 +
custom), slippage, priority fee, tip Jito optionnel ; Sell : 25/50/75/100 % ; bouton bleu BUY / rouge SELL ;
file des envois avec signature et lien solscan ; erreurs lisibles.

### /launch
Formulaire gauche : nom, symbol, description, liens (x, telegram, site), image (upload + aperçu carré),
**Clone** : coller un mint → préremplit nom/symbol/description/image via `parseMintMetadata`.
Options droite : wallet dev, dev buy (SOL), slippage, mode d'envoi (**Bundle Jito** = create + achats
des wallets sélectionnés dans le même bundle, tip ; **Staggered** = create puis snipes échelonnés avec délai),
liste des wallets acheteurs avec montant chacun (groupes du portfolio sélectionnables), **Sniper** (wallets
qui snipent dès le mint), **Auto-dump** (vendre X % quand le MC atteint Y $ ou après N s — exécuté côté
serveur dans une boucle `setInterval` module-level), **Volume** (achats/ventes répétés min-max SOL, délai
min-max, N tours, depuis un groupe). Presets sauvegardés (localStorage + fichier JSON serveur). Bouton
**LAUNCH** → modal de résumé → progression en live (SSE) : mint, signature(s), état par wallet.
Un « Quick Launch » = lancer depuis un preset en un clic.

### /dev (Dev room) — la page centrale pour un dev pump.fun
Liste de **mes launches** (tokens créés depuis cette app, journal local) + champ « ouvrir un mint ». Pour le token
sélectionné : état de la courbe (Bonded %, market cap, réserves, migré ou non), **positions de tous mes wallets**
(dev, bundle, snipers, volume : quantité, valeur SOL, PnL, % du supply détenu au total), boutons **Sell 25/50/100 %
sur la sélection** et **Dump all** (vend tous les wallets, Jito bundle si demandé, confirmation modale),
**Creator fees** (lecture `readPumpCreatorFees` + bouton Claim), **Volume bot** (démarrer/arrêter : groupe, min-max
SOL, délai min-max, tours, journal live), **Auto-dump** armé/désarmé (seuil MC ou délai), journal des
transactions avec liens solscan. Tout est en SSE / polling 2 s. C'est ici que le dev passe son temps après le launch.

### /portfolio (menu « Wallets »)
Gauche : **Developer wallets** (liste, drag pour réordonner, renommer au clic, actif = badge), **Groups**
(créer, ajouter/retirer des wallets), archivés. Haut droite : total SOL, valeur positions USD, PnL
(24h / 7j / 30j / all en USD ou SOL, calendrier simple) ; actions : **Create** (N wallets), **Import** (clés
base58 ou JSON, une par ligne), **Export** (clé d'un wallet ou sélection, affiché après re-saisie de la
passphrase), **Deposit** (adresse + QR `qrcode`), **Withdraw** (SOL vers une adresse), **Disperse** (un
wallet → plusieurs, montant min-max, délai min-max, via `distributeSol`), **Consolidate** (plusieurs → un, via
`sweepSol`), **Transfer** (wallet A → wallet B). Bas : **Holdings** (positions via `readPositions` : token,
quantité, valeur, PnL, boutons sell 50/100 %) et **Activity** (journal local des opérations : fichier
JSON `data/activity.json` dans `%LOCALAPPDATA%\trench\`).

### /settings
RPC lecture / RPC envoi (défaut `SOLANA_PUBLIC_RPC`), clé PumpPortal (optionnelle, active les trades live par
token), slippage/priority/tip par défaut, presets P1-P3 globaux, keybinds (1/2/3 = quick buy P1-P3 sur la carte
survolée, Esc ferme), thème (sombre seul pour l'instant), **Lock / Unlock** du keystore (passphrase) et
**Create keystore** au premier lancement.

Au premier lancement sans keystore : écran central « Create your vault » (passphrase forte x2) puis portfolio.
Keystore verrouillé : bandeau jaune en haut, actions signantes désactivées, lecture seule OK.

## API (route handlers, `src/app/api/**`, JSON) — contrat partagé

Tous les handlers passent par `src/server/*.ts` (singleton `globalThis.__trench` pour survivre au HMR).
Erreurs : `{ error: string }` + status 4xx/5xx. Les montants SOL en string décimal côté API, lamports en interne.

Keystore / wallets
- `GET  /api/vault` → `{ exists, unlocked, path }`
- `POST /api/vault/create {passphrase}` · `POST /api/vault/unlock {passphrase}` · `POST /api/vault/lock`
- `GET  /api/wallets` → `{ wallets:[{address,label,group,archived,order,sol}], groups:[{id,name}], active }`
- `POST /api/wallets/generate {count,label?,group?}` · `POST /api/wallets/import {lines:string[]}`
- `POST /api/wallets/update {address,label?,group?,archived?,order?}` · `POST /api/wallets/active {address}`
- `POST /api/wallets/export {address|addresses,passphrase}` → `{ keys:[{address,secret}] }`
- `POST /api/wallets/remove {addresses}` · `POST /api/groups {name}` · `DELETE /api/groups/[id]`
- `GET  /api/balances` → `{ [address]: sol }` (cache 5 s)

Fonds
- `POST /api/fund/withdraw {from,to,sol}` · `/api/fund/disperse {from,to:[addr],minSol,maxSol,minDelay,maxDelay}`
- `POST /api/fund/consolidate {from:[addr],to}` · `/api/fund/transfer {from,to,sol}`
- les opérations longues renvoient `{ jobId }` ; `GET /api/jobs/[id]` → `{ status, steps:[...], done, error }`

Marché
- `GET  /api/feed/stream` (SSE) : événements `snapshot` (état initial des 3 colonnes), `create`, `trade`,
  `migrate`, `update` (lot de cartes mises à jour toutes les 1-2 s), `solPrice`, `status`
- `GET  /api/token/[mint]` → métadonnées + curve (progress, MC, reserves, creator, createdAt, complete)
- `GET  /api/token/[mint]/trades?limit=` · `GET /api/token/[mint]/holders` · `GET /api/token/[mint]/candles?tf=`
- `GET  /api/sol-price` (Jupiter price API v3 ou coingecko simple, cache 30 s)

Trade / launch
- `POST /api/trade/buy {mint,wallets:[addr],sol,slippageBps,cuPrice?,tipSol?}` → `{ jobId }`
- `POST /api/trade/sell {mint,wallets,percent,slippageBps,cuPrice?}` → `{ jobId }`
- `POST /api/launch/prepare {metadata..., imageDataUrl}` → `{ uri, mint }` (upload IPFS + mint keypair gardé en mémoire serveur)
- `POST /api/launch/execute {mint, dev, devBuySol, mode:'bundle'|'staggered', buyers:[{address,sol}], snipers:[...], tipSol, delays, autoDump?, volume?}` → `{ jobId }`
- `GET  /api/positions?wallets=` → `[{mint,symbol,name,image,amount,valueSol,costSol,pnlSol}]`
- `GET  /api/activity` · `GET /api/presets` · `POST /api/presets`
- `GET  /api/settings` · `POST /api/settings`

## Flux Trenches (serveur, `src/server/feed.ts`)

Une seule connexion `ws` à `wss://pumpportal.fun/api/data` (singleton global, reconnexion avec backoff ; PumpPortal
bannit les connexions multiples : garder `globalThis.__trenchFeed`). Sans clé : `subscribeNewToken` +
`subscribeMigration` (gratuits). Avec clé (settings) : `subscribeTokenTrade` sur les N mints affichés.
Sans clé, les chiffres (MC, progress, volume approximé par delta de réserves, tx via `getSignaturesForAddress`
plafonné) viennent d'un **polling RPC** `getMultipleAccountsInfo` des bonding curves des ~150 derniers mints
toutes les 2 s (`parseBondingCurve`). Classement : New = créés < 30 min et progress < 85 % ;
Almost bonded = progress ≥ 85 % et non complete ; Migrated = complete/migrés (événement migration ou
`complete=true`). Garder 100 cartes max par colonne. Les métadonnées (nom, image) via `uri` → ipfs → http.
Un probe de 10 s sur le websocket réel avant d'écrire le parseur : noter la forme exacte des messages dans
`src/server/feed.ts` en commentaire.

## Règles

- Un écran ne dit que ce que son code fait : aucune valeur simulée, aucune capsule « demo », pas de données
  factices. Un chiffre non calculable = capsule absente. Les zéros sont réels.
- Pas de dépendance payante obligatoire. Clé PumpPortal et RPC privé = optionnels dans Settings.
- Tout mouvement de fonds réel est déclenché par un clic explicite de l'utilisateur ; le serveur ne lance rien seul
  sauf auto-dump/volume configurés explicitement au launch.
- Après le build : `npm run lint` et `npx tsc --noEmit` verts, `npm run build` vert.
- Rapport final dans `REPORT.md` : ce qui est joué (preuves), ce qui n'est pas prouvé, ce qui est coupé.
