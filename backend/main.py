import os
import time
from typing import Dict, Optional, List
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from web3 import Web3
from backend.oracle import verify_carrier_status, compute_tracking_hash, OracleSignerNode

app = FastAPI(title="Decentralized Stripe 2-of-3 Threshold Oracle Network Service", version="1.0.0")

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:8000,http://127.0.0.1:8000,http://127.0.0.1:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

checkout_sessions: Dict[str, dict] = {}
tracked_orders: Dict[str, dict] = {}
order_nonces: Dict[str, int] = {}

# Initialize independent Oracle Signer Nodes
ORACLE_NODES: List[OracleSignerNode] = []
for idx, key_name in enumerate(["ORACLE1_PRIVATE_KEY", "ORACLE2_PRIVATE_KEY", "ORACLE3_PRIVATE_KEY"], start=1):
    pk = os.getenv(key_name)
    if pk:
        ORACLE_NODES.append(OracleSignerNode(node_id=f"oracle-node-{idx}", private_key=pk))

if len(ORACLE_NODES) < 2:
    raise RuntimeError("Insufficient active oracle nodes! At least 2 independent oracle node private keys (ORACLE1_PRIVATE_KEY, ORACLE2_PRIVATE_KEY, ORACLE3_PRIVATE_KEY) are required for threshold quorum.")

class CheckoutSessionRequest(BaseModel):
    order_id: str
    buyer: str
    seller: str
    item_price: int
    gross_amount: int
    token: str
    contract_address: str
    chain_id: int
    tracking_id: Optional[str] = "TRACK123"

class AttestationRequest(BaseModel):
    buyer: str

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "Decentralized Stripe 2-of-3 Threshold Oracle Network Service",
        "active_oracle_nodes_count": len(ORACLE_NODES),
        "node_addresses": [node.address for node in ORACLE_NODES],
        "threshold_required": 2
    }

@app.post("/api/v1/checkout/session")
def create_checkout_session(req: CheckoutSessionRequest):
    for field_name, addr in [("buyer", req.buyer), ("seller", req.seller), ("token", req.token), ("contract_address", req.contract_address)]:
        if not Web3.is_address(addr):
            raise HTTPException(status_code=400, detail=f"Invalid EVM address format for {field_name}: {addr}")

    if req.item_price <= 0 or req.chain_id <= 0:
        raise HTTPException(status_code=400, detail="item_price and chain_id must be positive integers!")

    expected_fee = (req.item_price * 10) // 10000
    if req.gross_amount != req.item_price + expected_fee:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid grossAmount fee surcharge! Expected grossAmount={req.item_price + expected_fee} (Item: {req.item_price}, Fee: {expected_fee}), got {req.gross_amount}."
        )

    session_id = f"sess_{req.order_id}"
    session_data = {
        "session_id": session_id,
        "order_id": req.order_id,
        "buyer": Web3.to_checksum_address(req.buyer),
        "seller": Web3.to_checksum_address(req.seller),
        "item_price": req.item_price,
        "gross_amount": req.gross_amount,
        "token": Web3.to_checksum_address(req.token),
        "contract_address": Web3.to_checksum_address(req.contract_address),
        "chain_id": req.chain_id,
        "tracking_id": req.tracking_id,
        "status": "pending_deposit"
    }
    checkout_sessions[session_id] = session_data
    tracked_orders[req.order_id] = session_data
    return session_data

@app.get("/api/v1/checkout/session/{session_id}")
def get_checkout_session(session_id: str):
    if session_id not in checkout_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    return checkout_sessions[session_id]

@app.post("/api/v1/order/{order_id}/attestation")
def create_order_attestation(order_id: str, req: AttestationRequest):
    if order_id not in tracked_orders:
        raise HTTPException(status_code=404, detail="Order not found")
    
    order = tracked_orders[order_id]
    
    if order.get("buyer") and req.buyer.lower() != order["buyer"].lower():
        raise HTTPException(status_code=400, detail="Buyer address mismatch! Cannot generate attestation for unauthorized buyer identity.")
    
    order["buyer"] = order.get("buyer", req.buyer)
    
    carrier_info = verify_carrier_status(order.get("tracking_id", ""))
    if carrier_info.get("status") == "DELIVERED":
        voucher_deadline = int(time.time()) + 3600
        current_nonce = order_nonces.get(order_id, 0) + 1
        order_nonces[order_id] = current_nonce
        carrier_id = carrier_info.get("carrier", "UPS")
        tracking_id = order.get("tracking_id", "TRACK123")
        tracking_hash = compute_tracking_hash(carrier_id, tracking_id)

        # Collect threshold attestations independently from available active OracleSignerNode instances
        quorum_attestations = []
        signatures = []

        for node in ORACLE_NODES[:2]:
            attestation = node.sign_release_voucher(
                contract_address=order["contract_address"],
                chain_id=order["chain_id"],
                order_id_hex=order["order_id"],
                buyer=req.buyer,
                seller=order["seller"],
                token=order["token"],
                gross_amount=order["gross_amount"],
                item_price=order["item_price"],
                carrier_id=carrier_id,
                tracking_hash_hex=tracking_hash,
                nonce=current_nonce,
                voucher_deadline=voucher_deadline
            )
            quorum_attestations.append(attestation)
            signatures.append(attestation["signature"])

        order["signatures"] = signatures
        order["quorum_attestations"] = quorum_attestations
        order["voucher_deadline"] = voucher_deadline
        order["nonce"] = current_nonce
        order["status"] = "ready_for_release"
        return {
            "status": "success",
            "threshold_met": True,
            "quorum_count": len(signatures),
            "order": order
        }

    return {"status": "pending_delivery", "carrier_info": carrier_info}
