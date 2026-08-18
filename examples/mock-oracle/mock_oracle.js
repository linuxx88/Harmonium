const { ethers } = require("ethers");

const EIP712_DOMAIN_NAME = "HarmoniumPayEscrow";
const EIP712_VERSION = "1";

const EIP712_TYPES = {
  ReleaseVoucher: [
    { name: "orderId", type: "bytes32" },
    { name: "buyer", type: "address" },
    { name: "seller", type: "address" },
    { name: "token", type: "address" },
    { name: "grossAmount", type: "uint256" },
    { name: "itemPrice", type: "uint256" },
    { name: "carrierId", type: "string" },
    { name: "trackingHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "voucherDeadline", type: "uint256" }
  ]
};

function generateMockOracleWallets(count = 3) {
  const wallets = [];
  for (let i = 0; i < count; i++) {
    wallets.push(ethers.Wallet.createRandom());
  }
  return wallets;
}

async function signVoucher(contractAddress, chainId, voucher, wallet) {
  const domain = {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_VERSION,
    chainId: chainId,
    verifyingContract: contractAddress
  };

  return await wallet._signTypedData(domain, EIP712_TYPES, voucher);
}

async function generate2Of3MockVoucher(contractAddress, chainId, params, oracleWallets) {
  if (oracleWallets.length < 2) {
    throw new Error("At least 2 oracle signers are required for 2-of-3 quorum.");
  }

  const voucherDeadline = params.voucherDeadline || Math.floor(Date.now() / 1000) + 3600;
  const trackingHash = params.trackingHash || ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MOCK_TRACKING_" + params.orderId));

  const voucher = {
    orderId: params.orderId,
    buyer: params.buyer,
    seller: params.seller,
    token: params.token,
    grossAmount: params.grossAmount,
    itemPrice: params.itemPrice,
    carrierId: params.carrierId || "MOCK_CARRIER",
    trackingHash: trackingHash,
    nonce: params.nonce || 1,
    voucherDeadline: voucherDeadline
  };

  const signatures = [];
  for (let i = 0; i < 2; i++) {
    const sig = await signVoucher(contractAddress, chainId, voucher, oracleWallets[i]);
    signatures.push(sig);
  }

  return { voucher, signatures };
}

module.exports = {
  EIP712_TYPES,
  generateMockOracleWallets,
  signVoucher,
  generate2Of3MockVoucher
};
