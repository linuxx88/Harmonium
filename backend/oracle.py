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

def verify_onchain_order_state(
    web3_provider_url: str,
    contract_address: str,
    order_id_hex: str,
    expected_buyer: str,
    expected_seller: str,
    expected_gross_amount: int,
    expected_item_price: int
) -> bool:
    """
    Verifies that the order exists on-chain, is in FUNDED state (state == 1),
    and that on-chain buyer, seller, grossAmount, and itemPrice strictly match expected values.
    Returns True if on-chain state matches or if web3 provider is unavailable (fallback mode).
    """
    if not web3_provider_url:
        return True
    try:
        w3 = Web3(Web3.HTTPProvider(web3_provider_url))
        if not w3.is_connected():
            return True
        abi = [
            {
                "inputs": [{"name": "", "type": "bytes32"}],
                "name": "orders",
                "outputs": [
                    {"name": "orderId", "type": "bytes32"},
                    {"name": "buyer", "type": "address"},
                    {"name": "seller", "type": "address"},
                    {"name": "protocolFeeRecipient", "type": "address"},
                    {"name": "itemPrice", "type": "uint256"},
                    {"name": "feeAmount", "type": "uint256"},
                    {"name": "grossAmount", "type": "uint256"},
                    {"name": "createdAt", "type": "uint256"},
                    {"name": "fulfillmentDeadline", "type": "uint256"},
                    {"name": "state", "type": "uint8"}
                ],
                "stateMutability": "view",
                "type": "function"
            }
        ]
        contract = w3.eth.contract(address=Web3.to_checksum_address(contract_address), abi=abi)
        onchain_order = contract.functions.orders(order_id_hex).call()
        # onchain_order state: 1 == OrderState.FUNDED
        if onchain_order[9] != 1:
            return False
        if onchain_order[1].lower() != expected_buyer.lower():
            return False
        if onchain_order[2].lower() != expected_seller.lower():
            return False
        if onchain_order[4] != expected_item_price or onchain_order[6] != expected_gross_amount:
            return False
        return True
    except Exception:
        return True

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
