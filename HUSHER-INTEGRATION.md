# Husher : intégration native dans DONCHAIN

## Utilisation

1. Conserve ton dossier de données de coffre et tes fichiers .env locaux. Remplace le code du projet avec le contenu de ce ZIP, puis lance `npm ci` si nécessaire et redémarre ton serveur sur ton port habituel.
2. Déverrouille le coffre. Renseigne la clé dans Settings → Workspace → Husher API key, ou directement dans la fenêtre Mixer à la première utilisation. La clé est enregistrée côté serveur selon le mécanisme de configuration local existant. Elle n'est jamais renvoyée par une réponse API au navigateur. Alternative : `HUSHER_API_KEY` dans `.env.local` (cette variable prend la priorité sur la clé enregistrée ; ne pas utiliser NEXT_PUBLIC).
3. Passe DONCHAIN sur mainnet. Dans Portfolio → Privacy funding, clique sur Mixer · Husher.
4. Sélectionne tes wallets. Saisis le total SOL et clique sur Split equal, ou ajuste les allocations. Elles doivent correspondre exactement au total.
5. Fetch Quote récupère les montants réellement estimés par Husher. Le minimum est récupéré auprès du fournisseur et chaque allocation est vérifiée par le devis.
6. Après revue et acceptation des conditions Husher, Create Husher order crée un ordre multi-destinations sur l'API et affiche l'adresse de dépôt et le montant.
7. Effectue toi-même le dépôt du montant indiqué en SOL sur Solana mainnet. La création de l'ordre ne signe aucune transaction et ne prélève aucun wallet. Le statut et les retraits par destination sont affichés dans DONCHAIN ; History permet de rouvrir un ordre après un redémarrage.

La page /husher ouvre maintenant cette même fenêtre native. Le raccourci externe précédent est remplacé.

## Fonctionnement et limites

- Service : Husher multi-exchange, SOL → SOL, provider husher, destinataires issus du coffre local.
- Répartitions exactes en lamports ; pourcentages transmis à Husher à dix décimales.
- Devis flottant : le montant reçu peut évoluer jusqu'à l'exécution. DONCHAIN impose une durée de revue de 60 secondes pour le devis ; ce n'est pas une garantie de taux fixe fournie par Husher.
- Ordres persistés dans husher-orders.json à côté des données du coffre. La clé n'est pas incluse dans ce ZIP.
- Un double clic ou une répétition sur le même devis ne crée pas deux ordres. Si la création distante a un résultat indéterminé, DONCHAIN conserve cette situation et ne relance pas automatiquement la création. Vérifie l'historique sur Husher avant de recommencer avec un nouveau devis.
- Avant d'afficher le dépôt, DONCHAIN vérifie les actifs, réseaux, montant, destinations et pourcentages renvoyés par Husher. Une incohérence ou une erreur de suivi masque les instructions de dépôt jusqu'à une nouvelle vérification réussie.
- Le titre Mixer correspond au point d'entrée demandé. Cette version ne promet pas l'effacement des liens entre wallets et n'utilise pas le endpoint séparé Private Exchange. SplitNOW n'est pas intégré.
- Aucun ordre réel ni dépôt réel n'a été exécuté pendant le développement. Les devis et limites ont été vérifiés en direct ; la création et le suivi sont vérifiés par tests avec réponses simulées.

## Référence utilisée

https://api-docs.husher.net/api-docs/
Base API : https://api.husher.net
Authentification : x-api-key

Endpoints :
- POST /api/v1/multi-exchange/rate
- POST /api/v1/multi-exchange
- GET /api/v1/multi-exchange/{multiExchangeOrderId}
- GET /api/v1/multi-exchange/minimum-withdrawals?token=SOL&network=SOL

## Vérification

`node --test tests/husher.test.cjs` : conservation des montants, décodage du devis réel, création répétée, validation des wallets/mainnet, expiration/consentement, création indéterminée, et rejet d'instructions de dépôt incohérentes.

## Route Block X (2026-10-07)

- Le Mixer est le tiroir de droite de Block X (`design/blockx/portfolio-mixer.html`) : Service Husher | SplitNOW (SplitNOW non branché), Total to mix + Split equal, une ligne par wallet, Deposit total.
- **Fetch Quote** interroge `GET /api/v1/multi-exchange/providers` (cache 10 min) puis `POST /rate` une fois par fournisseur (binance, kucoin, bybit, bitget, htx, mexc, gate, whitebit ; `husher` est écarté car la doc dit « binance and husher are equivalent »). Affiche **Quote total** et **Providers N available**.
- **Provider & delay per wallet** : pour chaque wallet, le meilleur fournisseur est présélectionné, menu trié par sortie estimée, délai en minutes (0 = instantané, max 10 080) et **Delay all**. Le serveur refuse un fournisseur qui n'a pas coté ce wallet ou un délai non entier. Envoyés à Husher comme `provider` et `timeDelay` de chaque destinataire.
- Après création : **Deposit address** (QR ou **Address only**), « Send X SOL to start the mixer », **Pay from wallet**, bloc Status / Service / Order / Destinations, **Done**.
- **Pay from wallet** (`POST /api/husher/orders/{id}/pay`) : revérifie l'ordre chez Husher, puis envoie exactement le montant vérifié à l'adresse vérifiée depuis un wallet du coffre (job « withdraw » normal, contrôle de solde). Jamais depuis un wallet destinataire, un seul paiement par ordre sauf si le job précédent a échoué, confirmation en deux clics.
