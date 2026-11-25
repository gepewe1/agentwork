// AgentWork — runtime config.
// Demo mode is the default and works fully offline from file:// .
// To use wallet mode later: set mode to "wallet", fill boardAddress with the
// deployed AgentWorkBoard address, keep agentIdAddress on the real Agent ID
// contract, and serve this folder over http(s) with MetaMask / Binance Wallet.
window.AGENTWORK_CONFIG = {
  mode: "wallet", // "demo" | "wallet"
  chainId: 56, // BNB Chain mainnet (use 97 for Chapel testnet experiments)
  boardAddress: "0x3d033dbEB7d886827C5BE4F718F5B992C477F5C3", // mainnet Board, deployed + BscScan-verified 2026-11-25
  agentIdAddress: "0x60b9262456de011f7d15a54cdd8c48baaa8b022f",
  targetInteractors: 30
};
