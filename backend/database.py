import os
import sqlite3
import json
import time
from typing import Optional, Dict, Any

DB_PATH = os.path.join(os.path.dirname(__file__), "decentralized_stripe.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            order_id TEXT PRIMARY KEY,
            session_id TEXT UNIQUE NOT NULL,
            buyer TEXT NOT NULL,
            seller TEXT NOT NULL,
            item_price INTEGER NOT NULL,
            gross_amount INTEGER NOT NULL,
            token TEXT NOT NULL,
            contract_address TEXT NOT NULL,
            chain_id INTEGER NOT NULL,
            tracking_id TEXT,
            status TEXT NOT NULL,
            nonce INTEGER NULLABLE,
            voucher_deadline INTEGER NULLABLE,
            signatures TEXT NULLABLE,
            created_at INTEGER NOT NULL
        )
    """)
    conn.commit()
    conn.close()

def save_order(session_data: Dict[str, Any]) -> Dict[str, Any]:
    conn = get_db_connection()
    cursor = conn.cursor()
    created_at = int(time.time())
    cursor.execute("""
        INSERT INTO orders (
            order_id, session_id, buyer, seller, item_price, gross_amount,
            token, contract_address, chain_id, tracking_id, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(order_id) DO UPDATE SET
            session_id=excluded.session_id,
            buyer=excluded.buyer,
            seller=excluded.seller,
            item_price=excluded.item_price,
            gross_amount=excluded.gross_amount,
            token=excluded.token,
            contract_address=excluded.contract_address,
            chain_id=excluded.chain_id,
            tracking_id=excluded.tracking_id,
            status=excluded.status
    """, (
        session_data["order_id"],
        session_data["session_id"],
        session_data["buyer"],
        session_data["seller"],
        session_data["item_price"],
        session_data["gross_amount"],
        session_data["token"],
        session_data["contract_address"],
        session_data["chain_id"],
        session_data.get("tracking_id"),
        session_data["status"],
        created_at
    ))
    conn.commit()
    conn.close()
    return get_order_by_session_id(session_data["session_id"])

def row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    data = dict(row)
    if data.get("signatures"):
        try:
            data["signatures"] = json.loads(data["signatures"])
        except Exception:
            pass
    return data

def get_order_by_session_id(session_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM orders WHERE session_id = ?", (session_id,))
    row = cursor.fetchone()
    conn.close()
    return row_to_dict(row) if row else None

def get_order_by_id(order_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM orders WHERE order_id = ?", (order_id,))
    row = cursor.fetchone()
    conn.close()
    return row_to_dict(row) if row else None

def update_order_attestation(order_id: str, buyer: str, status: str, nonce: int, voucher_deadline: int, signatures: list) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    signatures_json = json.dumps(signatures)
    cursor.execute("""
        UPDATE orders SET
            buyer = ?,
            status = ?,
            nonce = ?,
            voucher_deadline = ?,
            signatures = ?
        WHERE order_id = ?
    """, (buyer, status, nonce, voucher_deadline, signatures_json, order_id))
    conn.commit()
    conn.close()
    return get_order_by_id(order_id)
