const {
  loadFixture
} = require("@nomicfoundation/hardhat-toolbox/network-helpers")
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs")
const { expect } = require("chai")
const { ethers } = require("hardhat")
const { any } = require("hardhat/internal/core/params/argumentTypes")

describe("VRFConsumer", function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployFixture() {
    // Contracts are deployed using the first signer/account by default
    const [owner, otherAccount] = await ethers.getSigners()

    const BASE_FEE = "100000000000000000"
    const GAS_PRICE_LINK = "1000000000" // 0.000000001 LINK per gas

    const coordinatorFactory = await ethers.getContractFactory("VRFCoordinatorV2Mock")
    const coordinator = await coordinatorFactory.deploy(BASE_FEE, GAS_PRICE_LINK)

    const fundAmount = "1000000000000000000"
    const subscription = await coordinator.createSubscription()
    const subscriptionReceipt = await subscription.wait(1)
    const subscriptionId = subscriptionReceipt.logs[0].topics[1]

    await coordinator.fundSubscription(subscriptionId, fundAmount)

    const keyHash = "0xd89b2bf150e3b9e13446986e571fb9cab24b13cea0a43ea20a6049a85cc807cc"
    const consumerFactory = await ethers.getContractFactory("VRFConsumer")
    const consumer = await consumerFactory.connect(owner).deploy(subscriptionId, coordinator.target, keyHash)

    await coordinator.addConsumer(subscriptionId, consumer.target)

    return { consumer, coordinator, owner, otherAccount }
  }

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const { consumer, owner } = await loadFixture(deployFixture)

      expect(await consumer.getOwner()).to.equal(owner.address)
    })
  })

  describe("Betting", function () {
    it("Should store the bet and make it available for contract owner", async function () {
      const { consumer, owner, otherAccount } = await loadFixture(deployFixture)

      await consumer.connect(otherAccount).pick(2)

      expect(await consumer.getPick(otherAccount)).to.equal(2)
      expect(await consumer.getPick(owner)).to.equal(0)
    })

    it("Should store the bet and make it unavailable for other accounts", async function () {
      const { consumer, owner, otherAccount } = await loadFixture(deployFixture)

      await consumer.connect(otherAccount).pick(2)

      await expect(consumer.connect(otherAccount).getPick(otherAccount))
        .to.be.revertedWith("You are not allowed to call this function!")
    })

    it("Should fail if the bet is not between tails and heads", async function () {
      const { consumer, otherAccount } = await loadFixture(deployFixture)

      await expect(consumer.connect(otherAccount).pick(3)).to.be.revertedWith("Must be tails or heads.")
    })
  })

  describe("Depositing", function () {
    it("Should fail if the amount is too high", async function () {
      const { consumer, otherAccount } = await loadFixture(deployFixture)

      await expect(consumer.connect(otherAccount).deposit({ value: ethers.parseEther("0.1") }))
        .to.be.revertedWith("Deposit is too high")
    })

    it("Should increase user's balance if value is correct", async function () {
      const { consumer, owner, otherAccount } = await loadFixture(deployFixture)

      await consumer.connect(otherAccount).deposit({ value: ethers.parseEther("0.01") })
      
      expect(await consumer.connect(owner).getBalance(otherAccount)).to.equal(ethers.parseEther("0.01"))
    })

    it("Should fallback when no params are sent (using receive function)", async function () {
      const { consumer, owner, otherAccount } = await loadFixture(deployFixture)

      await otherAccount.sendTransaction({
        to: consumer,
        value: ethers.parseEther("0.01")
      })
      
      expect(await consumer.connect(owner).getBalance(otherAccount)).to.equal(ethers.parseEther("0.01"))
    })

    it("Should fallback when some params are sent (using fallback function)", async function () {
      const { consumer, owner, otherAccount } = await loadFixture(deployFixture)

      await otherAccount.sendTransaction({
        to: consumer,
        value: ethers.parseEther("0.01"),
        data: "0x1234"
      })
      
      expect(await consumer.connect(owner).getBalance(otherAccount)).to.equal(ethers.parseEther("0.01"))
    })
  })

  describe("Getting balance", function () {
    it("Should return the correct balance if owner calls it", async function () {
      const { consumer, owner, otherAccount } = await loadFixture(deployFixture)

      await consumer.connect(otherAccount).deposit({ value: ethers.parseEther("0.01") })

      expect(await consumer.connect(owner).getBalance(otherAccount)).to.equal(ethers.parseEther("0.01"))
    })

    it("Should fail if other account calls it", async function () {
      const { consumer, otherAccount } = await loadFixture(deployFixture)

      await consumer.connect(otherAccount).deposit({ value: ethers.parseEther("0.01") })

      await expect(consumer.connect(otherAccount).getBalance(otherAccount))
        .to.be.revertedWith("You are not allowed to call this function!")
    })
  })

  describe("Flipping", function () {
    it("Should fail if there is no bet placed yet", async function () {
      const { consumer, otherAccount } = await loadFixture(deployFixture)
      
      await consumer.connect(otherAccount).deposit({ value: ethers.parseEther("0.01") })
      await expect(consumer.connect(otherAccount).flipCoin()).to.be.revertedWith("You have to pick a side first!")
    })

    it("Should fail if there is no deposit made", async function () {
      const { consumer, otherAccount } = await loadFixture(deployFixture)
      
      await consumer.connect(otherAccount).pick(2)
      await expect(consumer.connect(otherAccount).flipCoin()).to.be.revertedWith("You have to deposit ETH first!")
    })

    it("Should emit CoinFlipped event", async function () {
      const { consumer, otherAccount } = await loadFixture(deployFixture)

      await consumer.connect(otherAccount).deposit({ value: ethers.parseEther("0.01") })
      await consumer.connect(otherAccount).pick(1)

      await expect(consumer.connect(otherAccount).flipCoin())
        .to.emit(consumer, "CoinFlipped").withArgs(anyValue, otherAccount.address)
    })

    it("Should store the request ID value and make it available for contract owner", async function () {
      const { consumer, owner, otherAccount } = await loadFixture(deployFixture)

      await consumer.connect(otherAccount).deposit({ value: ethers.parseEther("0.01") })
      await consumer.connect(otherAccount).pick(2)
      await consumer.connect(otherAccount).flipCoin()

      expect(await consumer.getRequest(otherAccount)).not.to.equal(0);
      expect(await consumer.getRequest(owner)).to.equal(0);
    })

    it("Should store the request ID value and make it unavailable for other accounts", async function () {
      const { consumer, owner, otherAccount } = await loadFixture(deployFixture)

      await consumer.connect(otherAccount).deposit({ value: ethers.parseEther("0.01") })
      await consumer.connect(otherAccount).pick(2)
      await consumer.connect(otherAccount).flipCoin()

      await expect(consumer.connect(otherAccount).getRequest(otherAccount))
        .to.be.revertedWith("You are not allowed to call this function!")
    })

    it("Should prevent from flipping again when coin didn't land yet", async function () {
      const { consumer, otherAccount } = await loadFixture(deployFixture)

      await consumer.connect(otherAccount).deposit({ value: ethers.parseEther("0.01") })
      await consumer.connect(otherAccount).pick(2)
      await consumer.connect(otherAccount).flipCoin()

      await expect(consumer.connect(otherAccount).flipCoin()).to.be.revertedWith("Flip is in progress, coin didn't land yet!")
    })
  })

  describe("Receiving random number", function () {
    it("Should emit CoinLanded event", async function () {
      const { consumer, coordinator, otherAccount } = await loadFixture(deployFixture)

      await consumer.connect(otherAccount).deposit({ value: ethers.parseEther("0.01") })
      await consumer.connect(otherAccount).pick(2)
      await consumer.connect(otherAccount).flipCoin()
      const requestId = await consumer.getRequest(otherAccount)

      await expect(coordinator.fulfillRandomWords(requestId, consumer.target))
        .to.emit(consumer, "CoinLanded").withArgs(requestId, anyValue)
    })

    it("Should store the result and make it available for the contract owner", async function () {
      const { consumer, coordinator, owner, otherAccount } = await loadFixture(deployFixture)

      await consumer.connect(otherAccount).deposit({ value: ethers.parseEther("0.01") })
      await consumer.connect(otherAccount).pick(2)
      await consumer.connect(otherAccount).flipCoin()
      const requestId = await consumer.getRequest(otherAccount)
      await coordinator.fulfillRandomWords(requestId, consumer.target)

      expect(await consumer.getResult(otherAccount)).not.to.equal(0);
      expect(await consumer.getResult(owner)).to.equal(0);
    })

    it("Should store the result and make it unavailable for other accounts", async function () {
      const { consumer, coordinator, owner, otherAccount } = await loadFixture(deployFixture)

      await consumer.connect(otherAccount).deposit({ value: ethers.parseEther("0.01") })
      await consumer.connect(otherAccount).pick(2)
      await consumer.connect(otherAccount).flipCoin()
      const requestId = await consumer.getRequest(otherAccount)
      await coordinator.fulfillRandomWords(requestId, consumer.target)

      await expect(consumer.connect(otherAccount).getResult(otherAccount))
        .to.be.revertedWith("You are not allowed to call this function!")
    })

    it("Should clear the request ID value, so player can flip again", async function () {
      const { consumer, coordinator, otherAccount } = await loadFixture(deployFixture)

      await consumer.connect(otherAccount).deposit({ value: ethers.parseEther("0.01") })
      await consumer.connect(otherAccount).pick(2)
      await consumer.connect(otherAccount).flipCoin()
      const requestId = await consumer.getRequest(otherAccount)
      await coordinator.fulfillRandomWords(requestId, consumer.target)

      expect(await consumer.getRequest(otherAccount)).to.equal(0);
      await expect(consumer.connect(otherAccount).flipCoin()).not.to.be.reverted
    })
  })

  describe("Withdrawing prize", function () {
    it("Should fail if the result is not available yet", async function () {
      const { consumer, otherAccount } = await loadFixture(deployFixture)

      await consumer.connect(otherAccount).deposit({ value: ethers.parseEther("0.01") })
      await consumer.connect(otherAccount).pick(2)
      await consumer.connect(otherAccount).flipCoin()

      await expect(consumer.connect(otherAccount).withdrawToWinner()).to.be.revertedWith("You have to play first!")
    })

    it("Should fail if user didn't win", async function () {
      const { consumer, coordinator, otherAccount } = await loadFixture(deployFixture)

      await consumer.connect(otherAccount).deposit({ value: ethers.parseEther("0.01") })
      await consumer.connect(otherAccount).pick(2)
      await consumer.connect(otherAccount).flipCoin()
      const requestId = await consumer.getRequest(otherAccount)
      await coordinator.fulfillRandomWordsWithOverride(requestId, consumer.target, [4])

      await expect(consumer.connect(otherAccount).withdrawToWinner())
        .to.be.revertedWith("You didn't win this bet, so you cannot withdraw.")
    })

    it("Should fail if contract balance is too low", async function () {
      const { consumer, coordinator, otherAccount } = await loadFixture(deployFixture)

      await consumer.connect(otherAccount).deposit({ value: ethers.parseEther("0.01") })
      await consumer.connect(otherAccount).pick(2)
      await consumer.connect(otherAccount).flipCoin()
      const requestId = await consumer.getRequest(otherAccount)
      await coordinator.fulfillRandomWordsWithOverride(requestId, consumer.target, [5])

      await expect(consumer.connect(otherAccount).withdrawToWinner())
        .to.be.revertedWith("Not enough balance to withdraw. Please contact the owner.")
    })

    it("Should send the prize to the winner", async function () {
      const { consumer, coordinator, owner, otherAccount } = await loadFixture(deployFixture)

      await consumer.connect(owner).deposit({ value: ethers.parseEther("0.01") })
      await consumer.connect(otherAccount).deposit({ value: ethers.parseEther("0.01") })
      await consumer.connect(otherAccount).pick(2)
      await consumer.connect(otherAccount).flipCoin()
      const requestId = await consumer.getRequest(otherAccount)
      await coordinator.fulfillRandomWordsWithOverride(requestId, consumer.target, [5])

      await expect(() => consumer.connect(otherAccount).withdrawToWinner())
        .to.changeEtherBalance(otherAccount, ethers.parseEther("0.019"))
    })
  })
})
