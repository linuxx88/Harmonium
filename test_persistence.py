import unittest
import os
import json
from fastapi.testclient import TestClient

import secrets

# Generate disposable ephemeral test accounts for test environment
os.environ["ORACLE1_PRIVATE_KEY"] = "0x" + secrets.token_hex(32)
os.environ["ORACLE2_PRIVATE_KEY"] = "0x" + secrets.token_hex(32)
os.environ["WEB3_PROVIDER_URL"] = ""

from unittest.mock import patch
from backend.main import app
from backend.database import init_db, DB_PATH

class TestSQLitePersistence(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = TestClient(app)

    @patch("backend.main.verify_onchain_order_state", return_value=True)
    def test_persistence_across_restart(self, mock_verify):
        order_id = "0x" + "1" * 64
        session_req = {
            "order_id": order_id,
            "buyer": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
            "seller": "0x3C44CdDDB6a900fa2b585dd299e03d12FA4293BC",
            "item_price": 1000000,
            "gross_amount": 1001000,
            "token": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
            "contract_address": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
            "chain_id": 31337,
            "tracking_id": "TRACK123"
        }
        
        # 1. Create checkout session
        res = self.client.post("/api/v1/checkout/session", json=session_req)
        self.assertEqual(res.status_code, 200)
        session_id = res.json()["session_id"]

        # 2. Request attestation (generates signatures and ready_for_release)
        att_res = self.client.post(f"/api/v1/order/{order_id}/attestation", json={"buyer": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"})
        self.assertEqual(att_res.status_code, 200)
        data = att_res.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["order"]["status"], "ready_for_release")
        self.assertTrue(len(data["order"]["signatures"]) >= 2)

        # 3. Simulate Server Restart by creating a brand new TestClient instance
        new_client = TestClient(app)

        # 4. Fetch checkout session and verify state & signatures persisted in SQLite
        get_res = new_client.get(f"/api/v1/checkout/session/{session_id}")
        self.assertEqual(get_res.status_code, 200)
        persisted_order = get_res.json()

        self.assertEqual(persisted_order["status"], "ready_for_release")
        self.assertIsNotNone(persisted_order["signatures"])
        self.assertTrue(len(persisted_order["signatures"]) >= 2)
        print("\n[SUCCESS] Persistence verified! Status 'ready_for_release' and signatures retained across simulated restart.")

    def test_verify_onchain_order_state_fails_closed_when_empty_url(self):
        from backend.oracle import verify_onchain_order_state
        result = verify_onchain_order_state("", "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512", "0x" + "2" * 64, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", "0x3C44CdDDB6a900fa2b585dd299e03d12FA4293BC", 1001000, 1000000)
        self.assertFalse(result)

    def test_verify_onchain_order_state_fails_closed_when_rpc_unreachable(self):
        from backend.oracle import verify_onchain_order_state
        result = verify_onchain_order_state("http://127.0.0.1:9999", "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512", "0x" + "3" * 64, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", "0x3C44CdDDB6a900fa2b585dd299e03d12FA4293BC", 1001000, 1000000)
        self.assertFalse(result)

if __name__ == "__main__":
    unittest.main()
