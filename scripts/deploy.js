// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// You can also run a script with `npx hardhat run <script>`. If you do that, Hardhat
// will compile your contracts, add the Hardhat Runtime Environment's members to the
// global scope, and execute the script.
const hre = require("hardhat")

async function main() {
 const BASE_FEE = "100000000000000000"
 const GAS_PRICE_LINK = "1000000000" // 0.000000001 LINK per gas

 const coordinator = await hre.ethers.deployContract("VRFCoordinatorV2Mock", [BASE_FEE, GAS_PRICE_LINK])
 await coordinator.waitForDeployment();
 console.log("Coordinator deployed to", coordinator.target)

 const fundAmount = "1000000000000000000"
 const subscription = await coordinator.createSubscription()
 const subscriptionReceipt = await subscription.wait(1)
 const subscriptionId = subscriptionReceipt.logs[0].topics[1]
 await coordinator.fundSubscription(subscriptionId, fundAmount)

 const keyHash = "0xd89b2bf150e3b9e13446986e571fb9cab24b13cea0a43ea20a6049a85cc807cc"
 const consumer = await hre.ethers.deployContract("VRFConsumer", [subscriptionId, coordinator.target, keyHash])
 await consumer.waitForDeployment();
 console.log("Consumer deployed to", consumer.target)

 await coordinator.addConsumer(subscriptionId, consumer.target)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
