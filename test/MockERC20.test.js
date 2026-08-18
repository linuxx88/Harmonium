const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MockERC20", function () {
  let token, owner, user;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy("Mock USD", "MUSD", 18);
    await token.deployed();
  });

  it("devrait initialiser les métadonnées correctement", async function () {
    expect(await token.name()).to.equal("Mock USD");
    expect(await token.symbol()).to.equal("MUSD");
    expect(await token.decimals()).to.equal(18);
  });

  it("devrait permettre le mint public", async function () {
    await token.mint(user.address, ethers.utils.parseEther("100"));
    expect((await token.balanceOf(user.address)).toString()).to.equal(ethers.utils.parseEther("100").toString());
  });

  it("devrait distribuer des tokens via faucet", async function () {
    await token.connect(user).faucet();
    expect((await token.balanceOf(user.address)).toString()).to.equal(ethers.utils.parseUnits("1000", 18).toString());
  });
});
