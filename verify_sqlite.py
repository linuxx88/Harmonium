import os
import sqlite3
import json
import time
from backend.database import init_db, save_order, get_order_by_session_id, update_order_attestation, DB_PATH

def test_db_persistence():
    print("=== Initialisation et Test de persistance SQLite ===")
    init_db()
    
    # 1. Création de la session
    order_id = "0x" + "b" * 64
    session_id = f"sess_{order_id}"
    session_data = {
        "session_id": session_id,
        "order_id": order_id,
        "buyer": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        "seller": "0x3C44CdDDB6a900fa2b585dd299e03d12FA4293BC",
        "item_price": 1000000,
        "gross_amount": 1001000,
        "token": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        "contract_address": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
        "chain_id": 31337,
        "tracking_id": "TRACK123",
        "status": "pending_deposit"
    }
    
    save_order(session_data)
    print("[OK] Session et ordre sauvegardés en SQLite.")
    
    # 2. Simulation de l'attestation 2-of-3 (signatures générées)
    signatures = ["0xSig1...", "0xSig2..."]
    nonce = int(time.time_ns())
    voucher_deadline = int(time.time()) + 3600
    
    update_order_attestation(
        order_id=order_id,
        buyer=session_data["buyer"],
        status="ready_for_release",
        nonce=nonce,
        voucher_deadline=voucher_deadline,
        signatures=signatures
    )
    print("[OK] Attestation mise à jour : statut 'ready_for_release' et signatures enregistrées.")
    
    # 3. Simulation du redémarrage du serveur (fermeture / réouverture de connexion DB)
    order_retrieved = get_order_by_session_id(session_id)
    
    assert order_retrieved is not None, "L'ordre doit être retrouvé !"
    assert order_retrieved["status"] == "ready_for_release", f"Statut attendu 'ready_for_release', obtenu '{order_retrieved['status']}'"
    assert order_retrieved["signatures"] == signatures, "Les signatures doivent correspondre à 100%"
    assert order_retrieved["nonce"] == nonce, "Le nonce doit être persistant"
    
    print("\n[SUCCÈS PARFAIT] Vérification validée !")
    print(f"Statut conservé : {order_retrieved['status']}")
    print(f"Signatures conservées : {order_retrieved['signatures']}")

if __name__ == "__main__":
    test_db_persistence()
