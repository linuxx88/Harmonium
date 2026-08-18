# Rapport d'Exécution des Tests Live Sepolia

Ce document consigne les tests d'intégration et les scénarios avancés exécutés directement sur le testnet Ethereum Sepolia.

---

## 1. Informations Générales

- **Réseau** : Ethereum Sepolia (Chain ID: 11155111)
- **Signer / Déployeur** : `0x619CdaB7C39cF5E218a6D41d3e053273293f404A`
- **Contrat Testé** : `MockERC20` (mSUSD)

---

## 2. Test d'Intégration de Base (`scripts/test_sepolia_live.js`)

- **Objectif** : Valider la connexion RPC, le chargement du `.env`, l'approbation d'allowance et le transfert simple.
- **Transactions** :
  - **Approve (1.0 token)** : [`0x647e44ab69b2fc97fcea333a3b4017cc810b86ecfe837ddc429ff66d587afa98`](https://sepolia.etherscan.io/tx/0x647e44ab69b2fc97fcea333a3b4017cc810b86ecfe837ddc429ff66d587afa98)
  - **Transfer (0.1 token)** : [`0x2e37e633a7ab0683826fa5f19f010ef78bcac9b4ccede46cd4a3e6dd6dccbc60`](https://sepolia.etherscan.io/tx/0x2e37e633a7ab0683826fa5f19f010ef78bcac9b4ccede46cd4a3e6dd6dccbc60)
- **Résultat** : Soldes validés (0.11828 ETH restant, 100 tokens mintés et confirmés).

---

## 3. Suite de Tests Avancés (`scripts/test_sepolia_advanced.js`)

### Scénario 1 : Revert sur Dépassement d'Allowance
- **Approve (5.0 tokens)** : [`0xbd1f7f7f2facc96c9be8481142132c09eb15fcfa486e01783e8b24bc9a2f93a3`](https://sepolia.etherscan.io/tx/0xbd1f7f7f2facc96c9be8481142132c09eb15fcfa486e01783e8b24bc9a2f93a3)
- **Tentative de `transferFrom` (10.0 tokens)** : Rejetée et revert capturé avec succès.

### Scénario 2 : Réclamation Faucet (+1000 tokens)
- **Tx Faucet** : [`0x727d8efa94ae46f12d57e3fb5120eccada2751152b5bbe2a251d013c3a20a508`](https://sepolia.etherscan.io/tx/0x727d8efa94ae46f12d57e3fb5120eccada2751152b5bbe2a251d013c3a20a508)
- **Impact** : Solde passé de 100.0 à 1100.0 tokens.

### Scénario 3 : Transfert vers Adresse Tierce (25 tokens)
- **Destinataire** : `0xd66c98714d5fa6F90F4fb54651DfF976dd98A19d`
- **Tx Transfer** : [`0xdf268563435ed4390c00a2bec0e5c205f3fe9948ff5879ba07426dc962007842`](https://sepolia.etherscan.io/tx/0xdf268563435ed4390c00a2bec0e5c205f3fe9948ff5879ba07426dc962007842)
- **Validation** : Solde du destinataire passé de 0.0 à 25.0 tokens.
