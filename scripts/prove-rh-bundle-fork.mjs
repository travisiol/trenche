// Proof of the Robinhood bundle launch on a Hardhat fork of Robinhood Chain (no real funds):
//  dev launchAndBuy with the bundle wallets on the snipe-tax exemption list, then each bundle wallet buys in its own
//  transaction with the min-out DONCHAIN computes (every other buy lands first, minus slippage), then a Sell All with
//  the worst-case sell min-out. Also a non-exempt wallet buying in the same second, to show what the exemption saves.
// Run: (canvas/contracts) FORK_URL=https://rpc.mainnet.chain.robinhood.com FORK_CHAIN_ID=4663 npx hardhat node --port 8799
//      node scripts/prove-rh-bundle-fork.mjs
import { createPublicClient, createTestClient, encodeFunctionData, formatEther, http, parseAbi, parseEther, parseEventLogs } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const RPC = process.env.FORK_RPC ?? "http://127.0.0.1:8799";
const chain = { id: 4663, name: "rh-fork", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC, { timeout: 600_000 }) });
const test = createTestClient({ chain, mode: "hardhat", transport: http(RPC, { timeout: 600_000 }) });

const FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const FWD = "0xe33E9E479dF8802cb0866d5d05258bEc4cF62948";
const ZERO = "0x0000000000000000000000000000000000000000";
const LP = "(string name,string symbol,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,address creatorFeeRecipient,uint16 creatorTaxBps,bool buybackEnabled,bytes32 expectedEconomics,bytes32 salt)";
const abi = parseAbi([
  `function launchAndBuy(${LP} params,uint256 launchConfigId,address pairToken,uint256 quoteIn,uint256 minTokensOut,address recipient,address[] snipeTaxExemptions) payable returns (address token,address curve,uint256 tokensOut)`,
  "function launchFee() view returns (uint256)",
  "function previewLaunchEconomics(uint256,address) view returns (bytes32)",
  "function buy(uint256 quoteIn,uint256 minTokensOut,address recipient) payable returns (uint256)",
  "function sell(uint256 tokensIn,uint256 minQuoteOut,address recipient) returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function getReserves() view returns (uint256,uint256)",
  "event CurveBuy(address indexed buyer,address indexed recipient,uint256 quoteIn,uint256 tokensOut,uint256 fee,uint256 tax)",
  "event CurveSell(address indexed seller,address indexed recipient,uint256 tokensIn,uint256 quoteOut,uint256 fee,uint256 tax)",
]);

const BPS = 10_000n;
const FRESH_Q = 1_680_000_000_000_000_000n;
const FRESH_T = 1_000_000_000_000_000_000_000_000_000n;
const buyOut = (q, t, i, fee) => {
  const net = i - (i * fee) / BPS;
  return (t * net) / (q + net);
};
const ok = (c, m) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${m}`);
  if (!c) process.exitCode = 1;
};

await test.mine({ blocks: 1 });
const dev = privateKeyToAccount(generatePrivateKey());
const bundle = [0, 1, 2].map(() => privateKeyToAccount(generatePrivateKey()));
const outsider = privateKeyToAccount(generatePrivateKey());
for (const a of [dev, ...bundle, outsider]) await test.setBalance({ address: a.address, value: parseEther("1") });

const fee = await pub.readContract({ address: FACTORY, abi, functionName: "launchFee" });
const econ = await pub.readContract({ address: FACTORY, abi, functionName: "previewLaunchEconomics", args: [0n, ZERO] });
const devBuy = parseEther("0.01");
const amounts = [parseEther("0.005"), parseEther("0.007"), parseEther("0.004")];
const params = { name: "Fork Proof", symbol: "FPRF", logo: "", description: "", socials: { twitter: "", telegram: "", discord: "", website: "", farcaster: "" }, creatorFeeRecipient: dev.address, creatorTaxBps: 0, buybackEnabled: false, expectedEconomics: econ, salt: `0x${"ab".repeat(32)}` };
const args = [params, 0n, ZERO, devBuy, 0n, dev.address, bundle.map((b) => b.address)];
const sim = await pub.simulateContract({ account: dev.address, address: FWD, abi, functionName: "launchAndBuy", args, value: fee + devBuy });
const [token, curve, devTokens] = sim.result;
console.log("predicted token", token, "curve", curve);
ok(devTokens === buyOut(FRESH_Q, FRESH_T, devBuy, 100n), `dev buy tokens = formula on fresh reserves (${formatEther(devTokens)})`);

// DONCHAIN's min-outs: every other buy of the launch lands first, then − 20 %
const feeBps = 100n;
const net = (w) => w - (w * feeBps) / BPS;
const allNet = net(devBuy) + amounts.reduce((t, w) => t + net(w), 0n);
const allOut = devTokens + amounts.reduce((t, w) => t + buyOut(FRESH_Q, FRESH_T, w, feeBps), 0n);
const minOuts = amounts.map((w) => {
  const q = FRESH_Q + allNet - net(w);
  const t = FRESH_T - (allOut - buyOut(FRESH_Q, FRESH_T, w, feeBps));
  return (buyOut(q, t, w, feeBps) * (BPS - 2000n)) / BPS;
});

const chainId = 4663;
const gasPrice = (await pub.getBlock()).baseFeePerGas * 3n + 1n;
const sign = (acct, tx) => acct.signTransaction({ chainId, type: "eip1559", maxFeePerGas: gasPrice, maxPriorityFeePerGas: 0n, ...tx });
// the launch and the bundle buys go in the same block (automine off), launch first — like the sequencer's FCFS order
await test.setAutomine(false);
const launchTx = await sign(dev, { to: FWD, data: encodeFunctionData({ abi, functionName: "launchAndBuy", args }), value: fee + devBuy, nonce: 0, gas: 5_000_000n });
const lh = await pub.request({ method: "eth_sendRawTransaction", params: [launchTx] });
const bh = [];
for (const [i, b] of bundle.entries()) {
  const tx = await sign(b, { to: curve, value: amounts[i], nonce: 0, gas: 260_000n, data: encodeFunctionData({ abi, functionName: "buy", args: [amounts[i], minOuts[i], b.address] }) });
  bh.push(await pub.request({ method: "eth_sendRawTransaction", params: [tx] }));
}
// an outsider (not exempt) in the same block, same size as wallet 1
const oTx = await sign(outsider, { to: curve, value: amounts[0], nonce: 0, gas: 260_000n, data: encodeFunctionData({ abi, functionName: "buy", args: [amounts[0], 0n, outsider.address] }) });
const oh = await pub.request({ method: "eth_sendRawTransaction", params: [oTx] });
await test.mine({ blocks: 1 });
await test.setAutomine(true);

const lr = await pub.getTransactionReceipt({ hash: lh });
ok(lr.status === "success", `launch mined (gas ${lr.gasUsed})`);
let got = 0n;
for (const [i, h] of bh.entries()) {
  const r = await pub.getTransactionReceipt({ hash: h });
  const ev = parseEventLogs({ abi, eventName: "CurveBuy", logs: r.logs })[0];
  ok(r.status === "success" && r.blockNumber === lr.blockNumber, `bundle wallet ${i + 1}: landed in the launch block, gas ${r.gasUsed}`);
  ok(ev && ev.args.tokensOut >= minOuts[i], `bundle wallet ${i + 1}: ${formatEther(ev.args.tokensOut)} tokens ≥ min-out ${formatEther(minOuts[i])}`);
  ok(ev && ev.args.fee * 100n <= amounts[i] * 2n, `bundle wallet ${i + 1}: fee ${formatEther(ev.args.fee)} ETH = ~1 % (exempt from the snipe tax)`);
  got += ev.args.tokensOut;
}
const or = await pub.getTransactionReceipt({ hash: oh });
const oev = parseEventLogs({ abi, eventName: "CurveBuy", logs: or.logs })[0];
console.log(`info  outsider (not exempt), same block, ${formatEther(amounts[0])} ETH: ${oev ? `${formatEther(oev.args.tokensOut)} tokens, fee ${formatEther(oev.args.fee)} ETH` : "reverted"}`);

// Sell All: approve + sell signed together per wallet, worst-case min-out (the other sells land first)
const [q0, t0] = await pub.readContract({ address: curve, abi, functionName: "getReserves" });
const bals = await Promise.all(bundle.map((b) => pub.readContract({ address: token, abi, functionName: "balanceOf", args: [b.address] })));
const total = bals.reduce((a, b) => a + b, 0n);
await test.setAutomine(false);
const sh = [];
for (const [i, b] of bundle.entries()) {
  const others = total - bals[i];
  const qq = q0 - (q0 * others) / (t0 + others);
  const tt = t0 + others;
  const g = (qq * bals[i]) / (tt + bals[i]);
  const minOut = ((g - (g * feeBps) / BPS) * (BPS - 2000n)) / BPS;
  await pub.request({ method: "eth_sendRawTransaction", params: [await sign(b, { to: token, nonce: 1, gas: 120_000n, data: encodeFunctionData({ abi, functionName: "approve", args: [curve, 2n ** 256n - 1n] }) })] });
  sh.push(await pub.request({ method: "eth_sendRawTransaction", params: [await sign(b, { to: curve, nonce: 2, gas: 260_000n, data: encodeFunctionData({ abi, functionName: "sell", args: [bals[i], minOut, b.address] }) })] }));
}
await test.mine({ blocks: 1 });
await test.setAutomine(true);
let back = 0n;
for (const [i, h] of sh.entries()) {
  const r = await pub.getTransactionReceipt({ hash: h });
  const ev = parseEventLogs({ abi, eventName: "CurveSell", logs: r.logs })[0];
  ok(r.status === "success", `Sell All wallet ${i + 1}: approve + sell in one block → ${ev ? formatEther(ev.args.quoteOut) : "?"} ETH`);
  back += ev?.args.quoteOut ?? 0n;
}
console.log(`info  bundle: ${formatEther(amounts.reduce((a, b) => a + b, 0n))} ETH in → ${formatEther(got)} tokens → ${formatEther(back)} ETH out (fees + the outsider's buy in between)`);
