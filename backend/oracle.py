import os
from typing import Optional
from eth_account import Account
from eth_abi import encode
from web3 import Web3

MOCK_SHIPPING_DB = {
    "TRACK123": {"status": "DELIVERED", "carrier": "UPS"},
    "TRACK456": {"status": "IN_TRANSIT", "carrier": "CANADA_POST"},
    "TRACK789": {"status": "DELIVERED", "carrier": "CANADA_POST"}
}

def verify_carrier_status(tracking_id: str) -> dict:
    return MOCK_SHIPPING_DB.get(tracking_id, {"status": "NOT_FOUND", "carrier": "UNKNOWN"})

def compute_tracking_hash(carrier_id: str, tracking_number: str) -> str:
    encoded_bytes = encode(['string', 'string'], [carrier_id, tracking_number])
    return "0x" + Web3.keccak(encoded_bytes).hex()

class OracleSignerNode:
    """
    Represents an independent, isolated Oracle Signer Identity Node.
    """
    def __init__(self, node_id: str, private_key: str):
        self.node_id = node_id
        self._private_key = private_key
        self.account = Account.from_key(private_key)
        self.address = self.account.address

    def sign_release_voucher(
        self,
        contract_address: str,
        chain_id: int,
        order_id_hex: str,
        buyer: str,
        seller: str,
        token: str,
        gross_amount: int,
        item_price: int,
        carrier_id: str,
        tracking_hash_hex: str,
        nonce: int,
        voucher_deadline: int
    ) -> dict:
        domain_data = {
            "name": "DecentralizedStripeEscrow",
            "version": "1",
            "chainId": chain_id,
            "verifyingContract": Web3.to_checksum_address(contract_address)
        }

        message_types = {
            "ReleaseVoucher": [
                {"name": "orderId", "type": "bytes32"},
                {"name": "buyer", "type": "address"},
                {"name": "seller", "type": "address"},
                {"name": "token", "type": "address"},
                {"name": "grossAmount", "type": "uint256"},
                {"name": "itemPrice", "type": "uint256"},
                {"name": "carrierId", "type": "string"},
                {"name": "trackingHash", "type": "bytes32"},
                {"name": "nonce", "type": "uint256"},
                {"name": "voucherDeadline", "type": "uint256"}
            ]
        }

        message_data = {
            "orderId": order_id_hex,
            "buyer": Web3.to_checksum_address(buyer),
            "seller": Web3.to_checksum_address(seller),
            "token": Web3.to_checksum_address(token),
            "grossAmount": gross_amount,
            "itemPrice": item_price,
            "carrierId": carrier_id,
            "trackingHash": tracking_hash_hex,
            "nonce": nonce,
            "voucherDeadline": voucher_deadline
        }

        signed = Account.sign_typed_data(
            private_key=self._private_key,
            domain_data=domain_data,
            message_types=message_types,
            message_data=message_data
        )

        return {
            "node_id": self.node_id,
            "signer_address": self.address,
            "signature": signed.signature.hex()
        }
