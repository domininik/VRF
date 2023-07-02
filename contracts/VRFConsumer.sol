// SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";

contract VRFConsumer is VRFConsumerBaseV2 {
  VRFCoordinatorV2Interface private immutable i_coordinator;

  // Subscription ID this contract uses for funding requests.
  uint64 private immutable i_subscriptionId;

  // The gas lane to use, which specifies the maximum gas price to bump to.
  // For a list of available gas lanes on each network,
  // see https://docs.chain.link/docs/vrf-contracts/#configurations
  bytes32 private immutable i_keyHash;

  // Depends on the number of requested values that you want sent to the
  // fulfillRandomWords() function. Storing each word costs about 20,000 gas,
  // so 100,000 is a safe default for this example contract. Test and adjust
  // this limit based on the network that you select, the size of the request,
  // and the processing of the callback request in the fulfillRandomWords()
  // function.
  uint32 private constant CALLBACK_GAS_LIMIT = 100000;

  // The default is 3, but you can set this higher.
  uint16 private constant REQUEST_CONFIRMATIONS = 3;

  // For this example, retrieve 1 random value in one request.
  // Cannot exceed VRFCoordinatorV2.MAX_NUM_WORDS.
  uint32 private constant NUM_WORDS = 1;

  uint64 private constant MAX_DEPOSIT = 0.01 ether;

  // User wins 190% of the bet or loses it all.
  uint8 private constant PRIZE_MULTIPLIER = 190;

  uint8 private constant HEADS = 1;
  uint8 private constant TAILS = 2;

  // Owner of this contract.
  address private immutable i_owner;

  // Request to user mapping.
  mapping(uint256 => address) private s_users;

  // User to request mapping.
  mapping(address => uint256) private s_requests;

  // User to bet mapping.
  mapping(address => uint8) private s_picks;

  // User to actual result mapping.
  mapping(address => uint256) private s_results;

  // User to deposits mapping.
  mapping(address => uint256) private s_deposits;

  event CoinFlipped(uint256 indexed requestId, address indexed user);
  event CoinLanded(uint256 indexed requestId, uint256 indexed result);

  modifier onlyOwner() {
    require(msg.sender == i_owner, "You are not allowed to call this function!");
    _;
  }

  /**
   * @notice Constructor inherits VRFConsumerBaseV2
   *
   * @param subscriptionId - the subscription ID that this contract uses for funding requests
   * @param vrfCoordinator - coordinator, check https://docs.chain.link/docs/vrf-contracts/#configurations
   * @param keyHash - the gas lane to use, which specifies the maximum gas price to bump to
   */
  constructor(
    uint64 subscriptionId,
    address vrfCoordinator,
    bytes32 keyHash
  ) VRFConsumerBaseV2(vrfCoordinator) {
    i_coordinator = VRFCoordinatorV2Interface(vrfCoordinator);
    i_keyHash = keyHash;
    i_owner = msg.sender;
    i_subscriptionId = subscriptionId;
  }

  receive() external payable {
    deposit();
  }

  fallback() external payable {
    deposit();
  }

  function deposit() public payable {
    require (msg.value <= MAX_DEPOSIT, "Deposit is too high");

    s_deposits[msg.sender] = msg.value;
  }

  function pick(uint8 result) public {
    require(result == TAILS || result == HEADS, "Must be tails or heads.");

    s_picks[msg.sender] = result;
  }

  /**
   * @notice Requests randomness
   * Assumes the subscription is funded sufficiently; 
   * "Words" in requestRandomWords refers to unit of data in Computer Science
   */
  function flipCoin() public returns (uint256 requestId) {
    address user = msg.sender;

    require(s_picks[user] > 0, "You have to pick a side first!");
    require(s_deposits[user] > 0, "You have to deposit ETH first!");
    require(s_requests[user] == 0, "Flip is in progress, coin didn't land yet!");

    // Will revert if subscription is not set and funded.
    requestId = i_coordinator.requestRandomWords(
      i_keyHash,
      i_subscriptionId,
      REQUEST_CONFIRMATIONS,
      CALLBACK_GAS_LIMIT,
      NUM_WORDS
    );

    s_users[requestId] = user;
    s_requests[user] = requestId;

    emit CoinFlipped(requestId, user);
    return requestId;
  }

  function withdrawToWinner() public {
    address user = msg.sender;

    require(s_picks[user] != 0 && s_results[user] != 0, "You have to play first!");
    require(s_picks[user] == s_results[user], "You didn't win this bet, so you cannot withdraw.");

    s_picks[user] = 0;
    s_results[user] = 0;

    uint256 amount = s_deposits[user] * PRIZE_MULTIPLIER / 100;

    require(amount <= address(this).balance, "Not enough balance to withdraw. Please contact the owner.");

    s_deposits[user] = 0;

    address payable userPayable = payable(user);
    userPayable.transfer(amount);
  }

  function getOwner() public view returns (address) {
    return i_owner;
  }

  function getBalance(address user) public view onlyOwner returns (uint256) {
    return s_deposits[user];
  }

  function getRequest(address user) public view onlyOwner returns (uint256) {
    return s_requests[user];
  }

  function getResult(address user) public view onlyOwner returns (uint256) {
    return s_results[user];
  }
  
  function getPick(address user) public view onlyOwner returns (uint8) {
    return s_picks[user];
  }

  /**
   * @notice Callback function used by VRF Coordinator
   *
   * @param requestId - id of the request
   * @param randomWords - array of random results from VRF Coordinator
   */
  function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal override {
    // transform the result to a number between 1 and 2 inclusively
    uint256 result = (randomWords[0] % 2) + 1;
    // assign the transformed value to the address in the results mapping variable
    address user = s_users[requestId];
    s_results[user] = result;
    // clear requests mapping
    s_requests[user] = 0;
    // emit event to signal that coin landed
    emit CoinLanded(requestId, result);
  }
}