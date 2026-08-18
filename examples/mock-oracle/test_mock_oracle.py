import unittest
import time
from eth_account import Account
from eth_account.messages import encode_typed_data
from web3 import Web3

from mock_oracle import (
    generate_mock_oracle_wallets,
    sign_voucher,
    generate_2_of_3_mock_voucher,
    EIP712_RELEASE_VOUCHER_TYPES
)

class TestMockOracle(unittest.TestCase):
    def test_mock_oracle_generation(self):
        wallets = generate_mock_oracle_wallets(3)
        self.assertEqual(len(wallets), 3)
        self.assertTrue(all(w.address.startswith("0x") for w in wallets))
        self.assertEqual(len(set(w.address for w in wallets)), 3)

    def test_valid_2_of_3_voucher_signature_recovery(self):
        wallets = generate_mock_oracle_wallets(3)
        keys = [w.key.hex() for w in wallets]
        addresses = [w.address for w in wallets]

        contract_addr = "0x1111111111111111111111111111111111111111"
        chain_id = 31337
        order_id = "0x" + "aa" * 32
        buyer = "0x2222222222222222222222222222222222222222"
        seller = "0x3333333333333333333333333333333333333333"
        token = "0x4444444444444444444444444444444444444444"

        voucher, sigs = generate_2_of_3_mock_voucher(
            contract_address=contract_addr,
            chain_id=chain_id,
            order_id_hex=order_id,
            buyer=buyer,
            seller=seller,
            token=token,
            gross_amount=1001000,
            item_price=1000000,
            oracle_keys=keys
        )

        self.assertEqual(len(sigs), 2)
        self.assertEqual(voucher["orderId"], order_id)
        self.assertEqual(voucher["itemPrice"], 1000000)
        self.assertEqual(voucher["grossAmount"], 1001000)

        domain_data = {
            "name": "HarmoniumPayEscrow",
            "version": "1",
            "chainId": chain_id,
            "verifyingContract": Web3.to_checksum_address(contract_addr)
        }

        signable_bytes = encode_typed_data(
            domain_data=domain_data,
            message_types=EIP712_RELEASE_VOUCHER_TYPES,
            message_data=voucher
        )

        recovered_0 = Account.recover_message(signable_bytes, signature=sigs[0])
        recovered_1 = Account.recover_message(signable_bytes, signature=sigs[1])

        self.assertEqual(recovered_0, addresses[0])
        self.assertEqual(recovered_1, addresses[1])
        self.assertNotEqual(recovered_0, recovered_1)

    def test_insufficient_keys_rejected(self):
        wallets = generate_mock_oracle_wallets(1)
        keys = [w.key.hex() for w in wallets]
        with self.assertRaises(ValueError):
            generate_2_of_3_mock_voucher(
                contract_address="0x1111111111111111111111111111111111111111",
                chain_id=31337,
                order_id_hex="0x" + "aa" * 32,
                buyer="0x2222222222222222222222222222222222222222",
                seller="0x3333333333333333333333333333333333333333",
                token="0x4444444444444444444444444444444444444444",
                gross_amount=1001000,
                item_price=1000000,
                oracle_keys=keys
            )

    def test_tampered_voucher_invalidates_signature(self):
        wallets = generate_mock_oracle_wallets(3)
        keys = [w.key.hex() for w in wallets]

        voucher, sigs = generate_2_of_3_mock_voucher(
            contract_address="0x1111111111111111111111111111111111111111",
            chain_id=31337,
            order_id_hex="0x" + "aa" * 32,
            buyer="0x2222222222222222222222222222222222222222",
            seller="0x3333333333333333333333333333333333333333",
            token="0x4444444444444444444444444444444444444444",
            gross_amount=1001000,
            item_price=1000000,
            oracle_keys=keys
        )

        domain_data = {
            "name": "HarmoniumPayEscrow",
            "version": "1",
            "chainId": 31337,
            "verifyingContract": Web3.to_checksum_address("0x1111111111111111111111111111111111111111")
        }

        tampered_data = {**voucher, "grossAmount": 9999999}
        signable_bytes = encode_typed_data(
            domain_data=domain_data,
            message_types=EIP712_RELEASE_VOUCHER_TYPES,
            message_data=tampered_data
        )
        recovered = Account.recover_message(signable_bytes, signature=sigs[0])
        self.assertNotEqual(recovered, wallets[0].address)

if __name__ == "__main__":
    unittest.main()
