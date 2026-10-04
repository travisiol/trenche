# Block X — captures de référence (2026-10-04, compte connecté, viewport 1440×900)

Source de vérité pour la reconstruction 1:1. Chaque `*.html` = `<body>` rendu (scripts/styles retirés, SVG vidés,
listes dédoublonnées à 3 éléments max par parent). Les classes sont les utilitaires Tailwind de Block X :
`css-e31506a4f4a1fddf.css` (148 Ko, utilitaires + composants) et `css-0b52713241b26a76.css` (17 Ko, base + variables).
Captures d'écran dans `shots/` (800×500, réduites depuis 1440×900).

| Fichier | Page Block X |
|---|---|
| dashboard.html | /sol/dashboard — New on chain, Portfolio PnL + calendrier, Latest launches, KOL signal, Rewards |
| trenches.html | /sol/trenches — 3 colonnes New / Almost bonded / Migrated, cartes |
| trending.html | /sol/trending — table classée, fenêtres 1m…24h, P1-P3 |
| launch-modal.html | /sol/launch/<id> avec la modal « Launch Token » ouverte |
| launch-workspace.html | /sol/launch/<id> — Chart · Tasks · Token info/Activity, rail droit |
| portfolio.html | /sol/portfolio — Developer Wallets / Groups / Marketplace, actions, Privacy funding |
| settings.html | /sol/settings — Appearance (thèmes, police), rail APP |
| trading.html | /sol/trading/<mint> — chart + trades + panneau Buy/Sell + Token info |
| (texte seul) | /rewards — onglets Fees / Referrals, chips Pump.fun / Bonk / Bags / Reward tokens, carte « Choose a launchpad » |

Variables CSS du thème « Block X » (relevées sur :root) : --bg-page #0d0d0f, --bg-50 #0a0a0a, --bg-100 #121212,
--input-100 #1a1b1f, --input-200 #161618, --line-50 #161618, --line-100 #1f2024, --line-200 #2a2b30,
--text-100 #f0f5f5, --text-200 #c8ccce, --text-300 #676e70, --accent #0052ff, --accent-hover #0047e0,
--accent-muted #0052ff1f, --increase #0052ff, --decrease #f6465d, --green-100 #86d97f, --yellow-100 #f8b951,
--orange-100 #f58536, --blue-100 #4ea7fa, --xblue #1d9bf0, --hover-100/200/300 #ffffff08/0f/17,
--surface-muted #ffffff0a, --surface-subtle #ffffff0f, --modal-overlay #0000008c, scrollbar 6px. Police Geist / Geist Mono.
Barre du bas : Quick Launch, prix BTC/SOL/ETH/BNB, état « Stable 52 MS · 132 FPS », icônes Discord/X/Docs.
