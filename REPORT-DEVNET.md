# DONCHAIN — rapport de preuve devnet (2026-10-04)

But : prouver chaque mouvement de fonds du serveur de bout en bout avec de vraies transactions sur Solana **devnet**,
corriger ce qui casse, ne rien changer au comportement mainnet. Jamais d'envoi mainnet.
Serveur de test : `TRENCH_DATA_DIR=<dossier isolé> TRENCH_FEED=off npx next dev -p 3985` (coffre, réglages et jobs
isolés ; `%LOCALAPPDATA%\trench` jamais touché).

## 0. Bloqueur : les SOL devnet
Tous les faucets publics ont refusé cette IP pendant toute la session : `api.devnet.solana.com` → `429 You've either
reached your airdrop limit today or the airdrop faucet has run dry` (réessayé toutes les 5 min pendant 1 h,
`scripts/faucet-loop.mjs`) ; testnet → `Internal error` ; ankr exige une clé ; faucet.solana.com exige un login GitHub
+ captcha. dev-1 est resté à 0 SOL : **aucune transaction réelle n'a pu partir**. Tout ce qui ne demande pas de SOL
est prouvé en vrai ; tout ce qui en demande est prouvé par simulation sur le vrai RPC des deux clusters (§3).

**Pour rejouer les vrais envois (2 min)** : alimenter `3JqRQbAqwwfpHdbvwF4zH6Rr9GQWE7hrfvmuLgNTstSk` (dev-1 du coffre
de test, passphrase `trench devnet e2e passphrase 2026`, dossier `scratchpad/trench-data`) avec 1-2 SOL sur
https://faucet.solana.com, puis `E2E_PHASE=funds node scripts/e2e-devnet.mjs` (withdraw, transfer, transfer relais,
disperse 1→4, disperse relais, consolidate 4→1) et `E2E_PHASE=launch node scripts/e2e-devnet.mjs` (prepare + execute
avec dev buy, bundle 2 wallets, sniper, buy, auto-dump 150 s, puis trade buy, sell 50 %, volume 3 tours, wash, fees,
dump 100 %). Ou utiliser son propre coffre avec `cluster:"devnet"` dans Settings.

## 1. pump.fun sur devnet — faits
| Compte | devnet | mainnet |
|---|---|---|
| programme `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | exécutable, programdata slot 503 483 683 | slot 452 654 932 |
| Global `4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf` | 1088 o | 1087 o |
| `fee_recipient` + `fee_recipients[7]` (compte 1 des buy/sell) | 8 adresses différentes (`68yFSZ…`, `6QgPsh…`, …) | = `PUMP_BUYBACK_FEE_RECIPIENTS` du moteur |
| seconde liste (compte 17, offset 741) | identique au mainnet | = `PUMP_FEE_RECIPIENTS` du moteur |
| courbe neuve : SOL virtuel / tokens virtuels / tokens réels | **1 SOL** / 1 073 000 000 / 793 100 000 | 30 SOL / idem / idem |
| fee bps / creator fee bps | 95 / 5 | 95 / 5 |

Transactions réelles décodées (`scripts/probe-txs.mjs`, `probe-create.mjs`) : buy = 18 comptes / 25 octets, sell = 16 / 24,
create_v2 = 16 comptes, sur les deux clusters, **exactement l'ordre du moteur** (l'IDL public à 16 comptes de buy est
périmé). Le frontend pump.fun envoie 11 octets d'arguments de fin sur create_v2, le moteur 2 : les deux simulent OK →
pas un bug, moteur intouché. Conséquence : `src/server/pumpcluster.ts` lit Global une fois par cluster et échange les
listes de destinataires et la courbe neuve du moteur (sans ça devnet échoue en `fee_recipient.rs:35 NotAuthorized`).
Les listes mainnet du moteur ont été vérifiées identiques au Global mainnet : comportement mainnet inchangé.

## 2. Prouvé en vrai (sans SOL)
Coffre (create/unlock/lock, mauvaise passphrase → 401) ; 5 wallets + soldes devnet ; bascule de cluster
(`effectiveRpcUrl`, `explorerSuffix`, `pump`) ; airdrop → 429 lisible ; **export → remove → import = même adresse**
(`8ggMSRVQxfNnkR6swWiVvAi8R3N5LigxFbkhT4znSeJX`, clé base58 de 88 caractères, 401 avec une mauvaise passphrase) ;
garde du transfert relais (`needs 0.100017 SOL (amount + fee + relay fee). Nothing was sent.`) ; launch prepare avec
vrai upload IPFS (mint `AWzo7asLK5XvdAp2DZDxo1KW2dHSmnk3x5x6vPEWT1aN`) ; lecture d'un token devnet (`Eh5xzR…`, 17,21 %) ;
lecture des fees créateur (vault `8BJBpV…`) ; achat devnet : synchro des constantes puis garde de solde ; garde du wash ;
**persistance après redémarrage** : jobs relus (`stopped`/`error`), mint en attente accepté, volume bot et auto-dump
restaurés `resumable:true` puis relancés par `{action:"resume"}` (même id de job, même compteur).

## 3. Prouvé par simulation (`node scripts/sim-bundle.mjs [rpc]`, `simulateTransaction` sur le vrai RPC)
| Transaction | mainnet | devnet |
|---|---|---|
| create_v2 + ATA dev + dev buy atomique (1230 o) | OK 187 333 CU | OK 192 730 CU |
| create_v2 seul, arguments du moteur | OK 98 362 CU | OK 102 288 CU |
| 4 achats du bundle seuls | échec sur mint absent (attendu hors bundle atomique) | idem |
| 4 achats sur une courbe vivante | OK ×4 (88-90 k CU) | OK ×4 (86-89 k CU) |
| achat puis vente 50 % dans une tx | OK 135 490 CU | OK 136 595 CU |
| devnet avec les destinataires mainnet (`SIM_NOSWAP=1`) | — | NotAuthorized 6000 sur create/buy/sell |

## 4. Non prouvé
Signatures réelles de withdraw / transfer / relais / disperse / consolidate, launch devnet + tâches, trade buy/sell,
dump, wash, tours de volume, vente de l'auto-dump, claim (0 SOL ; script e2e prêt) ; landing réel Jito (mainnet
seulement, jamais envoyé) ; restauration d'un launch en cours (même chemin de code que les boucles testées).

## 5. Persistance
`jobs.json` (200 derniers jobs ; un job en cours au moment du crash devient `stopped` : « Server restarted while this
job was running: nothing more was sent ») ; `runtime.json` (launches, boucles `vol:`, auto-dumps, mints en attente ;
restaurés arrêtés + `resumable:true`, rien ne repart seul). Reprise : `POST /api/dev/volume {action:"resume"}`,
`POST /api/dev/autodump {action:"resume"}`, `…/tasks/[taskId]/resume`.

## 6. Mainnet
Cluster `mainnet` (défaut ; RPC/Helius/Jito ne s'appliquent que là). Alimenter le wallet dev (dev buy + ~0,03 SOL de
création + tip + ~0,003 SOL par wallet du bundle, tip ≥ 0,001). Mêmes appels ; `viaRelay` marche (deux signatures, clé
relais jamais stockée). Ne jamais changer de cluster entre `/api/launch/prepare` et `/execute`.

## 7. Changements de contrat (src/lib/types.ts)
`Settings.cluster`, `explorerSuffix`, `effectiveRpcUrl`, `effectiveSendRpcUrl`, `pump` ; `JobStatus` + `"stopped"`,
`JobView.cluster` ; `viaRelay?` sur transfer/withdraw/disperse (jobs relais : `total = 2×`, phases `relay|hop1|hop2|recover`) ;
`POST /api/dev/airdrop` (409 mainnet, 429 faucet, 504 non confirmé) ; `POST /api/dev/wash` ; `resumable?` sur tâches,
volume et auto-dump ; actions `resume`. Env : `TRENCH_DATA_DIR`, `TRENCH_FEED=off`.
