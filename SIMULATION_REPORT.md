# Rapport de Simulation et Stress Test Multi-Agents (Pre-Audit Baseline)

**Date :** 15 Août 2026  
**Commit SHA :** `bb33a9fdd625b7db1019428ebdcdc1ece7a9cbe7`  
**Git Tag :** `pre-audit-baseline`  
**Environnement :** Nœud EVM / Anvil Local (EIP-712 & Multi-Oracle 2-of-3)

---

## 1. Architecture et Modélisation du Pool d'Agents (100 Agents)
* **70 Acheteurs :** Génération concurrente de commandes, signatures de vouchers EIP-712, dépôts USDC et confirmations de réception.
* **15 Marchands :** Réception des commandes, vérification d'expédition et retraits de fonds via règlement d'arbitrage.
* **10 Acteurs Malveillants (Chaos) :** Tentatives d'attaques par rejeu (replay nonce), falsification de payload de prix, signatures d'oracles tronquées (1-of-3), oracles non autorisés et duplication de signataire.
* **5 Nœuds Oracles :** Écoute des événements, validation cryptographique d'expédition, signature individuelle ECDSA EIP-712 et simulation de latence réseau.

---

## 2. Métriques Globales d'Exécution
| Métrique | Valeur | Statut |
| :--- | :--- | :--- |
| **Durée totale d'exécution** | 59.59 s | ✅ Nominal |
| **Agents concurrents actifs** | 100 agents | ✅ Nominal |
| **Volume de transactions minées** | 421 txs | ✅ Stable |
| **Débit moyen (Throughput)** | 7.07 TPS | ✅ Haute performance |
| **Temps moyen de convergence Quorum (2-of-3)** | 4 302.10 ms | ✅ Résilient |
| **Interblocages base SQLite (Deadlocks)** | 0 (Mode WAL) | ✅ Intègre |

---

## 3. Rapport d'Intégrité et Rejet des Attaques
| Vecteur d'Attaque Testé | Tentatives | Rejets Contrat (`revert`) | Fuites / Compromissions |
| :--- | :---: | :---: | :---: |
| **Signature tronquée (1-of-3 au lieu de 2-of-3)** | 10 | 10 (100 %) | 0 |
| **Signataire dupliqué (Même clé signant deux fois)** | 10 | 10 (100 %) | 0 |
| **Falsification du payload EIP-712 (Montant altéré)** | 10 | 10 (100 %) | 0 |
| **Attaque par Rejeu de Nonce (Replay Attack)** | 10 | 10 (100 %) | 0 |
| **Oracle non autorisé (Clé étrangère hors whitelist)** | 10 | 10 (100 %) | 0 |
| **TOTAL** | **50** | **50 (100.0 %)** | **0 (Zéro fuite)** |

---

## 4. Profil de Consommation de Gaz par Fonction
| Fonction Smart Contract | Gaz Moyen | Gaz Min | Gaz Max | Échantillon (N) |
| :--- | :---: | :---: | :---: | :---: |
| `approve(address,uint256)` (MockUSDC) | 36 683 | 26 443 | 46 343 | 103 |
| `createAndFundOrder(bytes32,address,uint256)` | 273 318 | 273 308 | 273 320 | 45 |
| `settleWithOracle(...)` (Quorum 2-of-3 EIP-712) | 127 032 | 118 151 | 152 375 | 27 |
| `claimRefund(bytes32)` (Timeout fallback) | 48 210 | 48 210 | 48 210 | 5 |

---

## 5. Conclusion & Conformité Pre-Audit
L'ensemble des invariants de sécurité (CEI, protection anti-rejeu, quorum strict 2-of-3 et non-séquestration des fonds après expiration) ont été validés sous charge concurrente maximale sans aucune faille détectée.
