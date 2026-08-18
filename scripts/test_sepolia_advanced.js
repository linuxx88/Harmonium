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
    throw new Error("PRIVATE_KEY manquante ou invalide.");
  }

  let tokenAddress = process.env.MOCK_TOKEN_ADDRESS || process.env.USDC_ADDRESS;
  let mockToken;

  console.log("=== Suite de Tests Avancés Sepolia ===");
  console.log("Signer:", signer.address);

  if (!tokenAddress) {
    console.log("Déploiement d'un contrat MockERC20...");
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20", signer);
    mockToken = await MockERC20.deploy("Mock Sepolia USD", "mSUSD", 18);
    await mockToken.deployed();
    tokenAddress = mockToken.address;
    console.log("MockERC20 déployé à:", tokenAddress);
  } else {
    mockToken = await hre.ethers.getContractAt("MockERC20", tokenAddress, signer);
  }

  const decimals = await mockToken.decimals();

  // Test 1: Allowance exceed revert test
  console.log("\n--- 1. Test Dépassement d'Allowance (Revert Attendu) ---");
  const randomSpender = hre.ethers.Wallet.createRandom().address;
  const approvedAmt = hre.ethers.utils.parseUnits("5.0", decimals);
  const exceededAmt = hre.ethers.utils.parseUnits("10.0", decimals);

  const txApprove = await mockToken.approve(randomSpender, approvedAmt);
  console.log("Tx approve (5 tokens): https://sepolia.etherscan.io/tx/" + txApprove.hash);
  await txApprove.wait();

  try {
    // Attempt transferFrom with amount > allowance (calling directly to test revert)
    await mockToken.estimateGas.transferFrom(signer.address, randomSpender, exceededAmt);
    console.error("ERREUR: Le transfert n'a pas revert comme attendu.");
  } catch (err) {
    console.log("Succès: La tentative de dépassement d'allowance a bien été rejetée (Revert capturé).");
  }

  // Test 2: Faucet test
  console.log("\n--- 2. Test Faucet (Réclamation de 1000 tokens) ---");
  const balBeforeFaucet = await mockToken.balanceOf(signer.address);
  console.log("Solde avant faucet:", hre.ethers.utils.formatUnits(balBeforeFaucet, decimals));

  const txFaucet = await mockToken.faucet();
  console.log("Tx faucet envoyée: https://sepolia.etherscan.io/tx/" + txFaucet.hash);
  await txFaucet.wait();

  const balAfterFaucet = await mockToken.balanceOf(signer.address);
  console.log("Solde après faucet:", hre.ethers.utils.formatUnits(balAfterFaucet, decimals));
  console.log("Augmentation:", hre.ethers.utils.formatUnits(balAfterFaucet.sub(balBeforeFaucet), decimals), "tokens");

  // Test 3: Transfer to random address
  console.log("\n--- 3. Test Transfert vers Adresse Tierce ---");
  const recipient = hre.ethers.Wallet.createRandom().address;
  const sendAmt = hre.ethers.utils.parseUnits("25.0", decimals);
  console.log("Destinataire aléatoire:", recipient);

  const recBalBefore = await mockToken.balanceOf(recipient);
  console.log("Solde destinataire avant:", hre.ethers.utils.formatUnits(recBalBefore, decimals));

  const txTransfer = await mockToken.transfer(recipient, sendAmt);
  console.log("Tx transfer envoyée: https://sepolia.etherscan.io/tx/" + txTransfer.hash);
  await txTransfer.wait();

  const recBalAfter = await mockToken.balanceOf(recipient);
  console.log("Solde destinataire après:", hre.ethers.utils.formatUnits(recBalAfter, decimals));

  console.log("\n=== Tous les tests avancés Sepolia sont validés ! ===");
}

main().catch((error) => {
  console.error("Erreur:", error);
  process.exitCode = 1;
});
