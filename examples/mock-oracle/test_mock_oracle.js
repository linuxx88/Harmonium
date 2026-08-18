const assert = require("assert");
const { ethers } = require("ethers");
const {
  EIP712_TYPES,
  generateMockOracleWallets,
  signVoucher,
  generate2Of3MockVoucher
} = require("./mock_oracle");

async function runTests() {
  console.log("Running Mock Oracle Automated Tests...");
  let passed = 0;

  // Test 1: Mock Oracle Wallets Generation
  {
    const wallets = generateMockOracleWallets(3);
    assert.strictEqual(wallets.length, 3, "Should generate 3 wallets");
    assert.notStrictEqual(wallets[0].address, wallets[1].address, "Addresses must be distinct");
    assert.notStrictEqual(wallets[1].address, wallets[2].address, "Addresses must be distinct");
    passed++;
    console.log("✓ Test 1: Ephemeral Oracle Wallets generation passed");
  }

  // Test 2: Valid 2-of-3 EIP-712 Voucher Generation and Recovery
  {
    const wallets = generateMockOracleWallets(3);
    const contractAddress = "0x1111111111111111111111111111111111111111";
    const chainId = 31337;
    const orderId = ethers.utils.hexlify(ethers.utils.randomBytes(32));
    const buyer = "0x2222222222222222222222222222222222222222";
    const seller = "0x3333333333333333333333333333333333333333";
    const token = "0x4444444444444444444444444444444444444444";

    const { voucher, signatures } = await generate2Of3MockVoucher(
      contractAddress,
      chainId,
      {
        orderId,
        buyer,
        seller,
        token,
        grossAmount: 1001000,
        itemPrice: 1000000,
        nonce: 1
      },
      wallets
    );

    assert.strictEqual(signatures.length, 2, "Must produce 2 signatures");
    assert.strictEqual(voucher.orderId, orderId);

    const domain = {
      name: "HarmoniumPayEscrow",
      version: "1",
      chainId: chainId,
      verifyingContract: contractAddress
    };

    const recovered0 = ethers.utils.verifyTypedData(domain, EIP712_TYPES, voucher, signatures[0]);
    const recovered1 = ethers.utils.verifyTypedData(domain, EIP712_TYPES, voucher, signatures[1]);

    assert.strictEqual(recovered0.toLowerCase(), wallets[0].address.toLowerCase());
    assert.strictEqual(recovered1.toLowerCase(), wallets[1].address.toLowerCase());
    assert.notStrictEqual(recovered0.toLowerCase(), recovered1.toLowerCase());
    passed++;
    console.log("✓ Test 2: Valid 2-of-3 EIP-712 signature recovery passed");
  }

  // Test 3: Insufficient Keys Handling
  {
    const wallets = generateMockOracleWallets(1);
    await assert.rejects(
      async () => {
        await generate2Of3MockVoucher(
          "0x1111111111111111111111111111111111111111",
          31337,
          { orderId: ethers.constants.HashZero, buyer: ethers.constants.AddressZero, seller: ethers.constants.AddressZero, token: ethers.constants.AddressZero, grossAmount: 0, itemPrice: 0 },
          wallets
        );
      },
      /At least 2 oracle signers are required/,
      "Should reject insufficient signers"
    );
    passed++;
    console.log("✓ Test 3: Insufficient keys rejection passed");
  }

  // Test 4: Tampered Voucher Invalidates EIP-712 Signature
  {
    const wallets = generateMockOracleWallets(3);
    const contractAddress = "0x1111111111111111111111111111111111111111";
    const chainId = 31337;
    const { voucher, signatures } = await generate2Of3MockVoucher(
      contractAddress,
      chainId,
      {
        orderId: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        buyer: "0x2222222222222222222222222222222222222222",
        seller: "0x3333333333333333333333333333333333333333",
        token: "0x4444444444444444444444444444444444444444",
        grossAmount: 1001000,
        itemPrice: 1000000
      },
      wallets
    );

    const domain = {
      name: "HarmoniumPayEscrow",
      version: "1",
      chainId: chainId,
      verifyingContract: contractAddress
    };

    const tamperedVoucher = { ...voucher, grossAmount: 999999999 };
    const recovered = ethers.utils.verifyTypedData(domain, EIP712_TYPES, tamperedVoucher, signatures[0]);
    assert.notStrictEqual(recovered.toLowerCase(), wallets[0].address.toLowerCase());
    passed++;
    console.log("✓ Test 4: Tampered payload signature mismatch passed");
  }

  console.log(`\nALL ${passed}/4 TESTS PASSED.`);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
