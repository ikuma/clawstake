const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ClawStake", function () {
  let clawStake, usdc, owner, alice, bob;
  const USDC_AMOUNT = ethers.parseUnits("100", 6);
  const MIN_STAKE = ethers.parseUnits("1", 6);
  const STAKE_AMOUNT = ethers.parseUnits("10", 6);

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    const ClawStake = await ethers.getContractFactory("ClawStake");
    clawStake = await ClawStake.deploy(await usdc.getAddress());

    await usdc.mint(alice.address, USDC_AMOUNT);
    await usdc.mint(bob.address, USDC_AMOUNT);

    const addr = await clawStake.getAddress();
    await usdc.connect(alice).approve(addr, ethers.MaxUint256);
    await usdc.connect(bob).approve(addr, ethers.MaxUint256);
  });

  // ===== Deployment =====

  describe("Deployment", function () {
    it("should set the correct USDC address", async function () {
      expect(await clawStake.usdc()).to.equal(await usdc.getAddress());
    });

    it("should set the deployer as owner", async function () {
      expect(await clawStake.owner()).to.equal(owner.address);
    });

    it("should start with zero markets", async function () {
      expect(await clawStake.marketCount()).to.equal(0);
    });

    it("should expose constants", async function () {
      expect(await clawStake.MIN_STAKE()).to.equal(MIN_STAKE);
      expect(await clawStake.REFUND_GRACE_PERIOD()).to.equal(30 * 24 * 60 * 60);
    });
  });

  // ===== Staking =====

  describe("Staking", function () {
    it("should create a market on first stake", async function () {
      await expect(clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT))
        .to.emit(clawStake, "MarketCreated")
        .to.emit(clawStake, "Staked");

      expect(await clawStake.marketCount()).to.equal(1);
    });

    it("should not re-create market on subsequent stakes", async function () {
      await clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT);

      await expect(clawStake.connect(bob).stake("test-market", false, STAKE_AMOUNT))
        .to.emit(clawStake, "Staked")
        .and.not.to.emit(clawStake, "MarketCreated");

      expect(await clawStake.marketCount()).to.equal(1);
    });

    it("should record YES stake correctly", async function () {
      await clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT);

      const info = await clawStake.getMarketInfo("test-market");
      expect(info.totalYes).to.equal(STAKE_AMOUNT);
      expect(info.totalNo).to.equal(0);

      const s = await clawStake.getStake("test-market", alice.address);
      expect(s.amountYes).to.equal(STAKE_AMOUNT);
      expect(s.amountNo).to.equal(0);
    });

    it("should record NO stake correctly", async function () {
      await clawStake.connect(alice).stake("test-market", false, STAKE_AMOUNT);

      const info = await clawStake.getMarketInfo("test-market");
      expect(info.totalYes).to.equal(0);
      expect(info.totalNo).to.equal(STAKE_AMOUNT);
    });

    it("should allow multiple stakers", async function () {
      await clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT);
      await clawStake.connect(bob).stake("test-market", false, STAKE_AMOUNT);

      const info = await clawStake.getMarketInfo("test-market");
      expect(info.totalYes).to.equal(STAKE_AMOUNT);
      expect(info.totalNo).to.equal(STAKE_AMOUNT);
    });

    it("should allow same user to add to position", async function () {
      await clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT);
      await clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT);

      const s = await clawStake.getStake("test-market", alice.address);
      expect(s.amountYes).to.equal(STAKE_AMOUNT * 2n);
    });

    it("should transfer USDC from staker to contract", async function () {
      const before = await usdc.balanceOf(alice.address);
      await clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT);
      const after = await usdc.balanceOf(alice.address);

      expect(before - after).to.equal(STAKE_AMOUNT);
      expect(await usdc.balanceOf(await clawStake.getAddress())).to.equal(STAKE_AMOUNT);
    });

    it("should reject stake below minimum", async function () {
      await expect(
        clawStake.connect(alice).stake("test-market", true, 100)
      ).to.be.revertedWithCustomError(clawStake, "StakeTooSmall");
    });

    it("should reject empty slug", async function () {
      await expect(
        clawStake.connect(alice).stake("", true, STAKE_AMOUNT)
      ).to.be.revertedWithCustomError(clawStake, "EmptySlug");
    });

    it("should reject stake on resolved market", async function () {
      await clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT);
      await clawStake.resolve("test-market", true);

      await expect(
        clawStake.connect(bob).stake("test-market", true, STAKE_AMOUNT)
      ).to.be.revertedWithCustomError(clawStake, "MarketAlreadyResolved");
    });

    it("should reject stake on cancelled market", async function () {
      await clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT);
      await clawStake.cancelMarket("test-market");

      await expect(
        clawStake.connect(bob).stake("test-market", true, STAKE_AMOUNT)
      ).to.be.revertedWithCustomError(clawStake, "MarketIsCancelled");
    });

    it("should reject stake on expired market", async function () {
      await clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT);

      const deadline = (await time.latest()) + 3600;
      await clawStake.setDeadline("test-market", deadline);

      await time.increaseTo(deadline + 1);

      await expect(
        clawStake.connect(bob).stake("test-market", true, STAKE_AMOUNT)
      ).to.be.revertedWithCustomError(clawStake, "MarketExpired");
    });

    it("should allow stake before deadline", async function () {
      await clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT);

      const deadline = (await time.latest()) + 3600;
      await clawStake.setDeadline("test-market", deadline);

      // Still before deadline
      await expect(
        clawStake.connect(bob).stake("test-market", false, STAKE_AMOUNT)
      ).to.not.be.reverted;
    });
  });

  // ===== Batch Staking =====

  describe("Batch Staking", function () {
    it("should stake on multiple markets in one tx", async function () {
      await clawStake.connect(alice).batchStake(
        ["market-1", "market-2", "market-3"],
        [true, false, true],
        [STAKE_AMOUNT, STAKE_AMOUNT, STAKE_AMOUNT]
      );

      expect(await clawStake.marketCount()).to.equal(3);

      const info1 = await clawStake.getMarketInfo("market-1");
      expect(info1.totalYes).to.equal(STAKE_AMOUNT);

      const info2 = await clawStake.getMarketInfo("market-2");
      expect(info2.totalNo).to.equal(STAKE_AMOUNT);

      const info3 = await clawStake.getMarketInfo("market-3");
      expect(info3.totalYes).to.equal(STAKE_AMOUNT);
    });

    it("should use single USDC transfer for batch", async function () {
      const before = await usdc.balanceOf(alice.address);
      await clawStake.connect(alice).batchStake(
        ["market-1", "market-2"],
        [true, false],
        [STAKE_AMOUNT, STAKE_AMOUNT]
      );
      const after = await usdc.balanceOf(alice.address);

      expect(before - after).to.equal(STAKE_AMOUNT * 2n);
    });

    it("should reject mismatched arrays", async function () {
      await expect(
        clawStake.connect(alice).batchStake(
          ["market-1"],
          [true, false],
          [STAKE_AMOUNT]
        )
      ).to.be.revertedWithCustomError(clawStake, "ArrayLengthMismatch");
    });

    it("should reject if any amount below minimum", async function () {
      await expect(
        clawStake.connect(alice).batchStake(
          ["market-1", "market-2"],
          [true, false],
          [STAKE_AMOUNT, 100]
        )
      ).to.be.revertedWithCustomError(clawStake, "StakeTooSmall");
    });
  });

  // ===== Resolution =====

  describe("Resolution", function () {
    beforeEach(async function () {
      await clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT);
      await clawStake.connect(bob).stake("test-market", false, STAKE_AMOUNT);
    });

    it("should resolve market correctly", async function () {
      await expect(clawStake.resolve("test-market", true))
        .to.emit(clawStake, "MarketResolved");

      const info = await clawStake.getMarketInfo("test-market");
      expect(info.resolved).to.be.true;
      expect(info.outcomeYes).to.be.true;
      expect(info.cancelled).to.be.false;
    });

    it("should reject non-owner resolution", async function () {
      await expect(
        clawStake.connect(alice).resolve("test-market", true)
      ).to.be.revertedWithCustomError(clawStake, "OwnableUnauthorizedAccount");
    });

    it("should reject double resolution", async function () {
      await clawStake.resolve("test-market", true);

      await expect(
        clawStake.resolve("test-market", false)
      ).to.be.revertedWithCustomError(clawStake, "MarketAlreadyResolved");
    });

    it("should reject resolution of non-existent market", async function () {
      await expect(
        clawStake.resolve("not-real", true)
      ).to.be.revertedWithCustomError(clawStake, "MarketDoesNotExist");
    });

    it("should reject resolution of cancelled market", async function () {
      await clawStake.cancelMarket("test-market");

      await expect(
        clawStake.resolve("test-market", true)
      ).to.be.revertedWithCustomError(clawStake, "MarketIsCancelled");
    });

    it("should auto-cancel when winning pool is zero", async function () {
      await clawStake.connect(alice).stake("one-sided", true, STAKE_AMOUNT);

      await expect(clawStake.resolve("one-sided", false))
        .to.emit(clawStake, "MarketResolved")
        .to.emit(clawStake, "MarketCancelled");

      const info = await clawStake.getMarketInfo("one-sided");
      expect(info.resolved).to.be.true;
      expect(info.cancelled).to.be.true;
    });
  });

  // ===== Claiming =====

  describe("Claiming", function () {
    beforeEach(async function () {
      await clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT);
      await clawStake.connect(bob).stake("test-market", false, STAKE_AMOUNT);
      await clawStake.resolve("test-market", true);
    });

    it("should pay winner the full pool (1v1)", async function () {
      const balanceBefore = await usdc.balanceOf(alice.address);

      await expect(clawStake.connect(alice).claim("test-market"))
        .to.emit(clawStake, "Claimed");

      const balanceAfter = await usdc.balanceOf(alice.address);
      expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT * 2n);
    });

    it("should reject loser claim", async function () {
      await expect(
        clawStake.connect(bob).claim("test-market")
      ).to.be.revertedWithCustomError(clawStake, "NothingToClaim");
    });

    it("should reject double claim", async function () {
      await clawStake.connect(alice).claim("test-market");

      await expect(
        clawStake.connect(alice).claim("test-market")
      ).to.be.revertedWithCustomError(clawStake, "AlreadyClaimed");
    });

    it("should reject claim on unresolved market", async function () {
      await clawStake.connect(alice).stake("unresolved", true, STAKE_AMOUNT);

      await expect(
        clawStake.connect(alice).claim("unresolved")
      ).to.be.revertedWithCustomError(clawStake, "MarketNotResolved");
    });

    it("should reject claim on cancelled market", async function () {
      // Market auto-cancelled due to no winning pool
      await clawStake.connect(alice).stake("one-sided", true, STAKE_AMOUNT);
      await clawStake.resolve("one-sided", false);

      await expect(
        clawStake.connect(alice).claim("one-sided")
      ).to.be.revertedWithCustomError(clawStake, "MarketIsCancelled");
    });

    it("should distribute proportionally among multiple winners", async function () {
      const stakeAlice = ethers.parseUnits("30", 6);
      const stakeBob = ethers.parseUnits("10", 6);

      await clawStake.connect(alice).stake("proportional", true, stakeAlice);
      await clawStake.connect(bob).stake("proportional", true, stakeBob);

      // Owner stakes on NO side
      await usdc.mint(owner.address, ethers.parseUnits("40", 6));
      await usdc.connect(owner).approve(await clawStake.getAddress(), ethers.MaxUint256);
      await clawStake.connect(owner).stake("proportional", false, ethers.parseUnits("40", 6));

      // Total pool = 80 USDC, YES pool = 40
      await clawStake.resolve("proportional", true);

      // Alice: 30/40 * 80 = 60 USDC
      const aliceBefore = await usdc.balanceOf(alice.address);
      await clawStake.connect(alice).claim("proportional");
      const aliceAfter = await usdc.balanceOf(alice.address);
      expect(aliceAfter - aliceBefore).to.equal(ethers.parseUnits("60", 6));

      // Bob: 10/40 * 80 = 20 USDC
      const bobBefore = await usdc.balanceOf(bob.address);
      await clawStake.connect(bob).claim("proportional");
      const bobAfter = await usdc.balanceOf(bob.address);
      expect(bobAfter - bobBefore).to.equal(ethers.parseUnits("20", 6));
    });
  });

  // ===== Refund =====

  describe("Refund", function () {
    it("should refund when market is cancelled by owner", async function () {
      await clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT);
      await clawStake.cancelMarket("test-market");

      const balanceBefore = await usdc.balanceOf(alice.address);

      await expect(clawStake.connect(alice).refund("test-market"))
        .to.emit(clawStake, "Refunded");

      const balanceAfter = await usdc.balanceOf(alice.address);
      expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT);
    });

    it("should refund both YES and NO stakes", async function () {
      await clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT);
      await clawStake.connect(alice).stake("test-market", false, STAKE_AMOUNT);
      await clawStake.cancelMarket("test-market");

      const balanceBefore = await usdc.balanceOf(alice.address);
      await clawStake.connect(alice).refund("test-market");
      const balanceAfter = await usdc.balanceOf(alice.address);

      expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT * 2n);
    });

    it("should refund when no-winner auto-cancel", async function () {
      await clawStake.connect(alice).stake("one-sided", true, STAKE_AMOUNT);
      await clawStake.resolve("one-sided", false); // No one bet NO

      const balanceBefore = await usdc.balanceOf(alice.address);
      await clawStake.connect(alice).refund("one-sided");
      const balanceAfter = await usdc.balanceOf(alice.address);

      expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT);
    });

    it("should refund after deadline + grace period", async function () {
      await clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT);

      const deadline = (await time.latest()) + 3600;
      await clawStake.setDeadline("test-market", deadline);

      // Move past deadline + grace period (30 days)
      await time.increaseTo(deadline + 30 * 24 * 60 * 60 + 1);

      const balanceBefore = await usdc.balanceOf(alice.address);
      await clawStake.connect(alice).refund("test-market");
      const balanceAfter = await usdc.balanceOf(alice.address);

      expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT);
    });

    it("should auto-cancel market on first expired refund", async function () {
      await clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT);

      const deadline = (await time.latest()) + 3600;
      await clawStake.setDeadline("test-market", deadline);

      await time.increaseTo(deadline + 30 * 24 * 60 * 60 + 1);

      await expect(clawStake.connect(alice).refund("test-market"))
        .to.emit(clawStake, "MarketCancelled");

      const info = await clawStake.getMarketInfo("test-market");
      expect(info.cancelled).to.be.true;
    });

    it("should reject refund for active market", async function () {
      await clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT);

      await expect(
        clawStake.connect(alice).refund("test-market")
      ).to.be.revertedWithCustomError(clawStake, "RefundNotAvailable");
    });

    it("should reject refund before grace period ends", async function () {
      await clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT);

      const deadline = (await time.latest()) + 3600;
      await clawStake.setDeadline("test-market", deadline);

      // Past deadline but within grace period
      await time.increaseTo(deadline + 3600);

      await expect(
        clawStake.connect(alice).refund("test-market")
      ).to.be.revertedWithCustomError(clawStake, "RefundNotAvailable");
    });

    it("should reject double refund", async function () {
      await clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT);
      await clawStake.cancelMarket("test-market");
      await clawStake.connect(alice).refund("test-market");

      await expect(
        clawStake.connect(alice).refund("test-market")
      ).to.be.revertedWithCustomError(clawStake, "NothingToRefund");
    });

    it("should reject refund for non-staker", async function () {
      await clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT);
      await clawStake.cancelMarket("test-market");

      await expect(
        clawStake.connect(bob).refund("test-market")
      ).to.be.revertedWithCustomError(clawStake, "NothingToRefund");
    });
  });

  // ===== Admin =====

  describe("Admin Functions", function () {
    beforeEach(async function () {
      await clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT);
    });

    it("should set deadline", async function () {
      const deadline = (await time.latest()) + 86400;
      await expect(clawStake.setDeadline("test-market", deadline))
        .to.emit(clawStake, "DeadlineSet");

      const info = await clawStake.getMarketInfo("test-market");
      expect(info.deadline).to.equal(deadline);
    });

    it("should remove deadline by setting to 0", async function () {
      await clawStake.setDeadline("test-market", 1000);
      await clawStake.setDeadline("test-market", 0);

      const info = await clawStake.getMarketInfo("test-market");
      expect(info.deadline).to.equal(0);
    });

    it("should cancel market", async function () {
      await expect(clawStake.cancelMarket("test-market"))
        .to.emit(clawStake, "MarketCancelled");

      const info = await clawStake.getMarketInfo("test-market");
      expect(info.cancelled).to.be.true;
    });

    it("should reject cancel on resolved market", async function () {
      await clawStake.connect(bob).stake("test-market", false, STAKE_AMOUNT);
      await clawStake.resolve("test-market", true);

      await expect(
        clawStake.cancelMarket("test-market")
      ).to.be.revertedWithCustomError(clawStake, "MarketAlreadyResolved");
    });

    it("should reject double cancel", async function () {
      await clawStake.cancelMarket("test-market");

      await expect(
        clawStake.cancelMarket("test-market")
      ).to.be.revertedWithCustomError(clawStake, "MarketIsCancelled");
    });

    it("should emit event on emergency withdraw", async function () {
      await usdc.mint(await clawStake.getAddress(), STAKE_AMOUNT);

      await expect(clawStake.emergencyWithdraw(await usdc.getAddress(), STAKE_AMOUNT))
        .to.emit(clawStake, "EmergencyWithdraw");
    });

    it("should reject non-owner admin calls", async function () {
      await expect(
        clawStake.connect(alice).setDeadline("test-market", 999)
      ).to.be.revertedWithCustomError(clawStake, "OwnableUnauthorizedAccount");

      await expect(
        clawStake.connect(alice).cancelMarket("test-market")
      ).to.be.revertedWithCustomError(clawStake, "OwnableUnauthorizedAccount");

      await expect(
        clawStake.connect(alice).emergencyWithdraw(await usdc.getAddress(), 1)
      ).to.be.revertedWithCustomError(clawStake, "OwnableUnauthorizedAccount");

      await expect(
        clawStake.connect(alice).resolve("test-market", true)
      ).to.be.revertedWithCustomError(clawStake, "OwnableUnauthorizedAccount");
    });
  });

  // ===== View Functions =====

  describe("View Functions", function () {
    it("should enumerate markets by index", async function () {
      await clawStake.connect(alice).stake("market-1", true, STAKE_AMOUNT);
      await clawStake.connect(alice).stake("market-2", false, STAKE_AMOUNT);

      expect(await clawStake.marketCount()).to.equal(2);

      const [, slug1] = await clawStake.getMarketByIndex(0);
      expect(slug1).to.equal("market-1");

      const [, slug2] = await clawStake.getMarketByIndex(1);
      expect(slug2).to.equal("market-2");
    });

    it("should return full market info", async function () {
      await clawStake.connect(alice).stake("test-market", true, STAKE_AMOUNT);

      const deadline = (await time.latest()) + 86400;
      await clawStake.setDeadline("test-market", deadline);

      const info = await clawStake.getMarketInfo("test-market");
      expect(info.totalYes).to.equal(STAKE_AMOUNT);
      expect(info.totalNo).to.equal(0);
      expect(info.resolved).to.be.false;
      expect(info.outcomeYes).to.be.false;
      expect(info.deadline).to.equal(deadline);
      expect(info.cancelled).to.be.false;
    });
  });
});
