"""
Development-Only Mock Oracle for Harmonium Protocol.
Generates disposable oracle keypairs and valid EIP-712 ReleaseVoucher quorum signatures.
No carrier APIs, databases, or cloud logic included.
"""
import time
from typing import List, Dict, Tuple
from eth_account import Account
from web3 import Web3

EIP712_RELEASE_VOUCHER_TYPES = {
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

def generate_mock_oracle_wallets(count: int = 3) -> List[Account]:
    """Generates ephemeral oracle keypairs for local testing."""
    return [Account.create(f"mock-oracle-entropy-{i}") for i in range(count)]

def sign_voucher(
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
    voucher_deadline: int,
    oracle_private_key: str
) -> str:
    """Produces an EIP-712 signature for a ReleaseVoucher."""
    domain_data = {
        "name": "HarmoniumPayEscrow",
        "version": "1",
        "chainId": chain_id,
        "verifyingContract": Web3.to_checksum_address(contract_address)
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
        private_key=oracle_private_key,
        domain_data=domain_data,
        message_types=EIP712_RELEASE_VOUCHER_TYPES,
        message_data=message_data
    )
    return signed.signature.hex()

def generate_2_of_3_mock_voucher(
    contract_address: str,
    chain_id: int,
    order_id_hex: str,
    buyer: str,
    seller: str,
    token: str,
    gross_amount: int,
    item_price: int,
    oracle_keys: List[str],
    carrier_id: str = "MOCK_CARRIER",
    nonce: int = 1,
    valid_duration: int = 3600
) -> Tuple[Dict, List[str]]:
    """
    Generates a deterministic 2-of-3 voucher package and signatures.
    Requires at least 2 distinct oracle private keys.
    """
    if len(oracle_keys) < 2:
        raise ValueError("At least 2 oracle private keys required for 2-of-3 quorum.")

    voucher_deadline = int(time.time()) + valid_duration
    tracking_hash = Web3.keccak(text=f"MOCK_TRACKING_{order_id_hex}").hex()

    voucher = {
        "orderId": order_id_hex,
        "buyer": Web3.to_checksum_address(buyer),
        "seller": Web3.to_checksum_address(seller),
        "token": Web3.to_checksum_address(token),
        "grossAmount": gross_amount,
        "itemPrice": item_price,
        "carrierId": carrier_id,
        "trackingHash": tracking_hash,
        "nonce": nonce,
        "voucherDeadline": voucher_deadline
    }

    signatures = []
    for key in oracle_keys[:2]:
        sig = sign_voucher(
            contract_address=contract_address,
            chain_id=chain_id,
            order_id_hex=order_id_hex,
            buyer=buyer,
            seller=seller,
            token=token,
            gross_amount=gross_amount,
            item_price=item_price,
            carrier_id=carrier_id,
            tracking_hash_hex=tracking_hash,
            nonce=nonce,
            voucher_deadline=voucher_deadline,
            oracle_private_key=key
        )
        signatures.append(sig)

    return voucher, signatures

if __name__ == "__main__":
    wallets = generate_mock_oracle_wallets(3)
    keys = [w.key.hex() for w in wallets]
    voucher, sigs = generate_2_of_3_mock_voucher(
        contract_address="0x0000000000000000000000000000000000000001",
        chain_id=31337,
        order_id_hex="0x" + "11" * 32,
        buyer="0x0000000000000000000000000000000000000002",
        seller="0x0000000000000000000000000000000000000003",
        token="0x0000000000000000000000000000000000000004",
        gross_amount=1001000,
        item_price=1000000,
        oracle_keys=keys
    )
    print("Mock voucher generated successfully with", len(sigs), "signatures.")
