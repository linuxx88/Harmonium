const hre = require("hardhat");

async function main() {
  const signers = await hre.ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("Aucun compte disponible. Veuillez définir la variable d'environnement PRIVATE_KEY avec une clé privée valide (64 caractères hex).");
  }
  const [deployer] = signers;
  console.log("Déploiement avec le compte :", deployer.address);

  const name = process.env.TOKEN_NAME || "Mock USD";
  const symbol = process.env.TOKEN_SYMBOL || "MUSD";
  const decimals = process.env.TOKEN_DECIMALS || 18;

  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy(name, symbol, decimals);

  await token.deployed();

  console.log(`MockERC20 (${symbol}) déployé à l'adresse :`, token.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
