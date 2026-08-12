import os
import asyncio
from typing import Dict, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from web3 import Web3
from backend.oracle import verify_carrier_status, sign_escrow_release

app = FastAPI(title="Decentralized Stripe Oracle Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage for checkout sessions and orders
checkout_sessions: Dict[str, dict] = {}
tracked_orders: Dict[str, dict] = {}

ORACLE_PRIVATE_KEY = os.getenv("ORACLE_PRIVATE_KEY")
if not ORACLE_PRIVATE_KEY:
    raise RuntimeError("ORACLE_PRIVATE_KEY environment variable is missing!")

class CheckoutSessionRequest(BaseModel):
    order_id: str
    seller: str
    amount: int
    tracking_id: Optional[str] = "TRACK123"

class WebhookCarrierUpdateRequest(BaseModel):
    tracking_id: str
    status: str

@app.get("/")
def read_root():
    return {"status": "online", "service": "Decentralized Stripe Oracle"}

@app.post("/api/v1/checkout/session")
def create_checkout_session(req: CheckoutSessionRequest):
    session_id = f"sess_{req.order_id}"
    session_data = {
        "session_id": session_id,
        "order_id": req.order_id,
        "seller": req.seller,
        "amount": req.amount,
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

@app.post("/api/v1/webhook/carrier-update")
def carrier_update_webhook(req: WebhookCarrierUpdateRequest):
    updated_orders = []
    for order_id, order in tracked_orders.items():
        if order.get("tracking_id") == req.tracking_id:
            order["carrier_status"] = req.status
            if req.status == "DELIVERED" and order.get("buyer"):
                sig = sign_escrow_release(
                    order_id_hex=order["order_id"],
                    buyer=order["buyer"],
                    seller=order["seller"],
                    amount=order["amount"],
                    oracle_private_key=ORACLE_PRIVATE_KEY
                )
                order["signature"] = sig
                order["status"] = "ready_for_release"
                updated_orders.append(order_id)
    return {"status": "success", "updated_orders": updated_orders}

@app.get("/api/v1/order/{order_id}/voucher")
def get_order_voucher(order_id: str, buyer: str):
    if order_id not in tracked_orders:
        raise HTTPException(status_code=404, detail="Order not found")
    
    order = tracked_orders[order_id]
    order["buyer"] = buyer
    
    carrier_info = verify_carrier_status(order.get("tracking_id", ""))
    if carrier_info.get("status") == "DELIVERED":
        sig = sign_escrow_release(
            order_id_hex=order["order_id"],
            buyer=buyer,
            seller=order["seller"],
            amount=order["amount"],
            oracle_private_key=ORACLE_PRIVATE_KEY
        )
        order["signature"] = sig
        order["status"] = "ready_for_release"
        return {"status": "DELIVERED", "signature": sig, "order": order}
    else:
        return {"status": carrier_info.get("status"), "signature": None, "order": order}
