import os
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3

MOCK_SHIPPING_DB = {
    "TRACK123": {"status": "DELIVERED", "carrier": "UPS"},
    "TRACK456": {"status": "IN_TRANSIT", "carrier": "CANADA_POST"},
    "TRACK789": {"status": "DELIVERED", "carrier": "CANADA_POST"}
}

def verify_carrier_status(tracking_id: str) -> dict:
    info = MOCK_SHIPPING_DB.get(tracking_id, {"status": "NOT_FOUND", "carrier": "UNKNOWN"})
    return info

def sign_escrow_release(order_id_hex: str, buyer: str, seller: str, amount: int, oracle_private_key: str) -> str:
    # Convert order_id_hex to bytes32 bytes
    if isinstance(order_id_hex, str):
        if order_id_hex.startswith("0x"):
            order_id_bytes = bytes.fromhex(order_id_hex[2:])
        else:
            order_id_bytes = bytes.fromhex(order_id_hex)
    else:
        order_id_bytes = order_id_hex

    buyer_bytes = bytes.fromhex(buyer[2:] if buyer.startswith("0x") else buyer)
    seller_bytes = bytes.fromhex(seller[2:] if seller.startswith("0x") else seller)
    amount_bytes = amount.to_bytes(32, byteorder='big')

    # Solidity keccak256(abi.encodePacked(orderId, buyer, seller, amount))
    packed = order_id_bytes + buyer_bytes + seller_bytes + amount_bytes
    message_hash = Web3.keccak(packed)

    signable_message = encode_defunct(primitive=message_hash)
    signed_message = Account.sign_message(signable_message, private_key=oracle_private_key)
    
    return signed_message.signature.hex()
