# TRENCH — rapport de build (2026-10-04)

Remake privé de Block X (blockx.gg) pour un dev Solana / pump.fun : même fonctionnement, DA façon Proxima avec icônes 3D.
Local uniquement : `npm run dev` → http://localhost:3985 (ou `npx next dev -p 3986`). Rien n'est déployé, rien n'est poussé.

## Ce qui est construit

| Page | Contenu | État |
|---|---|---|
| Portfolio | wallets (créer, importer, exporter, renommer, réordonner, archiver), groupes, deposit (QR), withdraw, disperse, consolidate, transfer, holdings + PnL, activité | joué : coffre créé, 5 wallets générés, soldes lus sur RPC |
| Launch | metadata ou clone d'un mint, image (upload/URL + recadrage carré), wallet dev, dev buy, tâches Block X (Bundle Jito, Sniper, Buy, Volume, Wash), auto-dump, sell on external volume, presets, Quick launch, résumé puis suivi live (SSE) | joué : clone réel, bundle 2 wallets, refus propre « Dev wallet holds 0 SOL but needs at least 0.531 SOL… Nothing was sent » |
| Dashboard | soldes, PnL 24h/7j/30j/all, tâches actives, mes launches avec MC live, Dev room (positions de tous les wallets, sell 25/50/100, Dump all, creator fees + claim, volume bot, auto-dump, journal) | affiché, vide (aucun launch) |
| Trade/[mint] | en-tête token, chandelles 1s/15s/1m (lightweight-charts) depuis l'historique de courbe + flux live, trades, holders, positions, panneau Buy/Sell (P1-P3, slippage, priority, tip Jito) | joué sur un mint réel : graphique + trades réels |
| Trenches | 3 colonnes New / Almost bonded / Migrated, recherche, presets P1-P3, hover gèle l'ordre, quick buy, raccourcis 1/2/3 | joué : flux live, 5 créations en 10 s |
| Trending | fenêtres 1m…24h, classement par momentum | répond (données du flux) |
| Rewards | fees créateur pump.fun par token lancé ou collé, claim, historique | lecture réelle prouvée par l'agent (vault d'un tiers lu) |
| Settings | RPC lecture/envoi, clés Helius et PumpPortal (optionnelles, jamais renvoyées), slippage / priority / tip / Jito par défaut, presets, raccourcis, coffre lock/unlock | affiché |

Serveur : Next 16 route handlers + singleton `globalThis.__trench` (survit au HMR). Moteur pump.fun = copie du moteur de
donchain.snipe (`src/engine/solana`), appelé par des wrappers typés (`src/server/engine.ts`). Keystore chiffré
(scrypt + AES) dans `%LOCALAPPDATA%\trench\keystore.enc.json` ; les clés ne sortent jamais de la machine, export
uniquement après re-saisie de la passphrase. Flux trenches : une seule connexion PumpPortal (gratuite : créations +
migrations) + polling RPC des bonding curves ; prix SOL via Jupiter (repli Coingecko).

## Prouvé

- Coffre : création, lock, unlock, mauvaise passphrase → 401. Export avec passphrase correcte → clé base58 ; mauvaise → 401.
- Wallets : génération, renommage, archivage, ordre, groupes, soldes RPC (0) ; wallet actif choisi automatiquement.
- Fonds et trades sur wallets vides : chaque route s'arrête avant tout envoi avec un message lisible (« needs 0.010012 SOL (amount + fee). Nothing was sent. »). Aucune transaction n'a jamais été diffusée.
- Launch : upload IPFS pump.fun réel (uri bafkrei…), keypair du mint gardée côté serveur, payload Block X accepté, refus net sur solde insuffisant.
- Volume bot : 2 tours réels sur un mint vivant, chaque tour échoue proprement (pas de SOL / rien à vendre), statut round/rounds/log.
- Auto-dump : armé avec délai, lit un market cap réel ($4 142), se déclenche à l'heure, le job de vente échoue proprement.
- Fees : lecture réelle d'un vault créateur (1,0657 SOL en attente pour un token tiers, `isMine:false`), claim refusé 400/409 comme prévu.
- Flux : 60 s sur serveur neuf = 24 créations, 106 trades, 51 mises à jour, 1 migration réelle parsée (pool pump-amm).
- Token : courbe réelle (réserves, progression, MC, créateur), trades signés, chandelles construites.
- `npx tsc --noEmit` et `npm run lint` : 0 erreur (60 warnings dans le moteur minifié repris, intouché).

## Non prouvé (il faut des SOL)

- Envoi réel d'un bundle Jito (create + 4 achats), snipes échelonnés, transferts SPL du Wash, vente réelle de l'auto-dump, claim réel : tout s'arrête aujourd'hui à la garde de solde ou aux pré-contrôles du moteur. Premier launch à faire avec 0,2-0,3 SOL de test.
- Ordre des comptes buy/sell de pump.fun vs le programme déployé aujourd'hui : le moteur donchain a été vérifié hors ligne, pas sur un envoi réel (voir mémoire donchain).
- Trades live par token (subscribeTokenTrade) : câblé, jamais testé (pas de clé PumpPortal).

## Limites du RPC public (sans clé)

- publicnode plafonne `getMultipleAccounts` à 10 clés et refuse `getTokenLargestAccounts` → holders = 503 explicite, capsule top 10 absente ; le serveur chunk à 10 et ralentit le polling (2 à 10 s).
- Volume et nombre de trades = approximation par delta de réserves (marqué « ~ » sur les cartes) tant qu'il n'y a pas de clé PumpPortal.
- holders count et bundle % toujours null (impossible sans RPC indexé).

## Coupé, volontairement

X tracker / KOL tracker (API X payante), BSC et Robinhood (moteur Pons disponible dans donchain, pas branché),
mixer, marketplace de wallets, abonnement et referrals (SaaS), login Discord/Telegram (inutile en privé),
websocket Helius (polling à la place ; la clé Helius sert déjà de RPC lecture + sender).

## À acheter pour « un tool au top »

| Besoin | Quoi | Prix |
|---|---|---|
| Regarder, acheter, lancer sans bundle | RPC public + Jito | 0 $ |
| Bundle et snipe fiables, holders, polling 100 courbes d'un coup | Helius **Developer** (staked connections, Sender, 50 req/s, 5 sendTransaction/s) | 49 $/mois |
| Trades live par token dans les trenches | Clé PumpPortal + wallet lié (0,02 SOL mini) | 0,01 SOL / 10 000 événements |
| Landing rate des bundles | Tip Jito 0,001 à 0,01 SOL par bundle (défaut TRENCH 0,001 ; Block X affiche « 1 ») | par launch |

Le plan gratuit Helius (1 sendTransaction/s) ne suffit pas pour un bundle. Business (499 $) n'apporte rien à un dev seul.
Coller la clé dans Settings → Helius API key : elle devient RPC lecture + endpoint sender automatiquement.

## Pièges connus

- PumpPortal bannit ~1 h une seconde connexion websocket depuis la même IP : un seul serveur TRENCH à la fois.
- Un `next dev` dont les pipes stdio meurent fait répondre 500 à toutes les routes dynamiques : redémarrer proprement (Stop-Process par PID).
- Les jobs, boucles et auto-dump vivent en mémoire : un redémarrage les perd (launches.json et activity.json restent).
