# Marketplace de wallets — DONCHAIN

## Installation

Cette archive part de `fafazo.zip` et conserve les fonctions existantes. Fermez le serveur avant de remplacer les fichiers du projet. Ne remplacez pas votre coffre ni votre dossier de données.

Dans le dossier du projet :

```sh
npm ci
npm run dev
```

Le script actuel utilise le port 3985. Ouvrez Portfolio → Marketplace, ou `/marketplace` sur le port de votre serveur.

## Utilisation

1. Déverrouillez le coffre et utilisez Solana mainnet.
2. Comparez le catalogue AnySwap, filtré par tier, source de financement, persona, région et prix. Les cartes sont triées par prix croissant. Sélectionnez de 1 à 20 wallets, individuellement ou avec « Select cheapest ».
3. Acceptez les conditions, puis réservez. Le serveur revalide le prix et les wallets avant de montrer l'adresse et le montant exact.
4. Envoyez manuellement le montant indiqué sur Solana mainnet avant l'expiration. Aucun transfert n'est signé par DONCHAIN. Le prix inclut le SOL présent dans le wallet ; les frais de votre transaction sont supplémentaires. Les valeurs de tokens sont des estimations.
5. Cliquez « I have sent payment · Verify deposit ». Cette action appelle la vérification du paiement du fournisseur ; elle n'envoie aucun fonds.
6. Après confirmation, cliquez sur l'import. Les clés sont récupérées par le serveur et importées dans votre coffre. Elles ne passent pas dans les réponses au navigateur. L'historique permet de reprendre une commande après redémarrage.

## Fournisseurs et limites

AnySwap est le seul fournisseur dont le catalogue, la création et l'annulation de réservation ont été testés en direct. Husher, Sumo et Proxima sont affichés avec un état indisponible : aucun faux stock ni faux bouton d'achat n'est associé à ces fournisseurs. Il n'y a donc pas encore de comparaison des prix entre fournisseurs actifs. Binance, KuCoin, etc. désignent l'origine de financement du wallet, pas le vendeur.

Le connecteur utilise les routes que le site public AnySwap utilise pour sa marketplace, sous `https://marketplace.anyswap.bot/api`. Ce ne sont pas les API de swap. Aucun compte ou clé API n'a été nécessaire pour la consultation et la réservation testées. Le contrat peut changer ; ce connecteur est expérimental et la livraison après un paiement réel reste non validée.

Les garanties de propriété exclusive des clés ne sont pas vérifiables : un vendeur peut garder une copie. DONCHAIN ne promet aucune anonymisation ni classification « organic ».

## Reprise après erreur

Les commandes sont enregistrées dans `marketplace-orders.json`, dans le dossier de données DONCHAIN. Ne supprimez pas ce fichier pour relancer une commande. Une création ambiguë est conservée et ne sera pas répétée avec le même identifiant. Utilisez l'historique pour vérifier la commande avant toute nouvelle réservation ou tout paiement.

La livraison des clés peut être unique. Le serveur n'effectue pas de deuxième demande si la première a échoué de façon ambiguë. Contactez le fournisseur avec l'identifiant de commande dans ce cas. Une livraison reçue est temporairement chiffrée avec le mot de passe du coffre ; si l'import échoue, la reprise utilise cette copie chiffrée, puis la supprime après import réussi. Gardez le même mot de passe jusqu'à la fin de l'import. Une interruption entre la réponse du fournisseur et sa sauvegarde locale peut nécessiter une récupération par le fournisseur.

Une commande expirée ne doit pas être payée. En cas de paiement déjà envoyé, utilisez la vérification ; ne payez pas une deuxième fois. N'annulez pas une commande si une transaction a été envoyée et n'est pas encore confirmée.

## Validation

- Lecture du catalogue Solana réel : HTTP 200.
- Réservation d'un wallet réel, réception des instructions de paiement, puis annulation : succès ; aucun fonds envoyé.
- Tests automatiques simulés : idempotence, montants exacts, coffre verrouillé/mainnet, changements de commande, absence de clés avant paiement, chiffrement et reprise d'import, demande de livraison ambiguë non répétée.
- Compilation Next.js et TypeScript, lint des fichiers ajoutés.
- Vérification HTTP du build : page et catalogue intégrés HTTP 200 (200 wallets), historique HTTP 200, origine étrangère refusée HTTP 403.
- Aucun achat payé ; livraison et import de véritables clés non testés en production.
