const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

function loadEnv() {
  const envPath = path.resolve(__dirname, "../.env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        val = val.replace(/^["'](.*)["']$/, "$1");
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

async function main() {
  const [signer] = await hre.ethers.getSigners();
  if (!signer) {
    throw new Error("PRIVATE_KEY manquante ou invalide dans .env");
  }

  let tokenAddress = process.env.MOCK_TOKEN_ADDRESS || process.env.USDC_ADDRESS;
  const targetAddress = process.env.SERVICE_CONTRACT_ADDRESS || process.env.ESCROW_ADDRESS || signer.address;

  console.log("=== Test d'intégration Sepolia ===");
  console.log("Signer:", signer.address);

  const ethBalanceBefore = await signer.getBalance();
  console.log("Solde ETH initial:", hre.ethers.utils.formatEther(ethBalanceBefore), "ETH");

  let mockToken;
  if (!tokenAddress) {
    console.log("Aucune adresse de token fournie dans .env. Déploiement d'un MockERC20 de test...");
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20", signer);
    mockToken = await MockERC20.deploy("Mock Sepolia USD", "mSUSD", 18);
    await mockToken.deployed();
    tokenAddress = mockToken.address;
    console.log("MockERC20 déployé à:", tokenAddress);
  } else {
    mockToken = await hre.ethers.getContractAt("MockERC20", tokenAddress, signer);
  }

  const decimals = await mockToken.decimals();
  const tokenBalanceBefore = await mockToken.balanceOf(signer.address);
  console.log("Solde Token initial:", hre.ethers.utils.formatUnits(tokenBalanceBefore, decimals));

  if (tokenBalanceBefore.isZero()) {
    console.log("Solde token nul, mint de 100 tokens...");
    const mintAmount = hre.ethers.utils.parseUnits("100.0", decimals);
    const txMint = await mockToken.mint(signer.address, mintAmount);
    await txMint.wait();
    console.log("Mint effectué.");
  }

  const testAmount = hre.ethers.utils.parseUnits("1.0", decimals);

  console.log("\nExécution de approve(" + targetAddress + ", 1.0)...");
  const txApprove = await mockToken.approve(targetAddress, testAmount);
  console.log("Tx approve envoyée: https://sepolia.etherscan.io/tx/" + txApprove.hash);
  await txApprove.wait();
  console.log("Approve confirmé.");

  console.log("\nExécution de transfer(" + signer.address + ", 0.1)...");
  const transferAmount = hre.ethers.utils.parseUnits("0.1", decimals);
  const txTransfer = await mockToken.transfer(signer.address, transferAmount);
  console.log("Tx transfer envoyée: https://sepolia.etherscan.io/tx/" + txTransfer.hash);
  await txTransfer.wait();
  console.log("Transfert confirmé.");

  const ethBalanceAfter = await signer.getBalance();
  const tokenBalanceAfter = await mockToken.balanceOf(signer.address);

  console.log("\n=== Soldes Finaux ===");
  console.log("Solde ETH final:", hre.ethers.utils.formatEther(ethBalanceAfter), "ETH");
  console.log("Solde Token final:", hre.ethers.utils.formatUnits(tokenBalanceAfter, decimals));
  console.log("Test d'intégration Sepolia terminé avec succès.");
}

main().catch((error) => {
  console.error("Erreur d'exécution:", error);
  process.exitCode = 1;
});
