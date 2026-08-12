import os
import time
from typing import Dict, Optional, List
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from backend.oracle import verify_carrier_status, sign_eip712_release_voucher

app = FastAPI(title="Decentralized Stripe EIP-712 Threshold Oracle Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

checkout_sessions: Dict[str, dict] = {}
tracked_orders: Dict[str, dict] = {}

ORACLE1_PRIVATE_KEY = os.getenv("ORACLE1_PRIVATE_KEY", "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d")
ORACLE2_PRIVATE_KEY = os.getenv("ORACLE2_PRIVATE_KEY", "0x5de4111daf478a9cda47a93b007d115f54d70212354887921e0614609772251e")

class CheckoutSessionRequest(BaseModel):
    order_id: str
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
    return {"status": "online", "service": "Decentralized Stripe EIP-712 Threshold Oracle Service"}

@app.post("/api/v1/checkout/session")
def create_checkout_session(req: CheckoutSessionRequest):
    session_id = f"sess_{req.order_id}"
    session_data = {
        "session_id": session_id,
        "order_id": req.order_id,
        "seller": req.seller,
        "item_price": req.item_price,
        "gross_amount": req.gross_amount,
        "token": req.token,
        "contract_address": req.contract_address,
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
    order["buyer"] = req.buyer
    
    carrier_info = verify_carrier_status(order.get("tracking_id", ""))
    if carrier_info.get("status") == "DELIVERED":
        voucher_deadline = int(time.time()) + 3600
        nonce = 1
        carrier_id = carrier_info.get("carrier", "UPS")
        tracking_hash = "0x" + "0" * 64 # Placeholder tracking hash for PoC API endpoint

        sig1 = sign_eip712_release_voucher(
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
            nonce=nonce,
            voucher_deadline=voucher_deadline,
            oracle_private_key=ORACLE1_PRIVATE_KEY
        )

        sig2 = sign_eip712_release_voucher(
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
            nonce=nonce,
            voucher_deadline=voucher_deadline,
            oracle_private_key=ORACLE2_PRIVATE_KEY
        )

        order["signatures"] = [sig1, sig2]
        order["voucher_deadline"] = voucher_deadline
        order["nonce"] = nonce
        order["status"] = "ready_for_release"
        return {"status": "success", "order": order}

    return {"status": "pending_delivery", "carrier_info": carrier_info}
