require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
const path = require("path");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// Use local solc npm package when network download is unavailable
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD)
  .setAction(async (taskArgs, hre, runSuper) => {
    if (taskArgs.solcVersion === "0.8.26") {
      const compilerPath = path.join(__dirname, "node_modules", "solc", "soljson.js");
      return {
        version: "0.8.26",
        longVersion: "0.8.26+commit.8a97fa7a.Emscripten.clang",
        compilerPath,
        isSolcJs: true,
      };
    }
    return runSuper();
  });

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 11155111,
    },
    hardhat: {
      chainId: 31337,
    },
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY || "",
    },
  },
};
