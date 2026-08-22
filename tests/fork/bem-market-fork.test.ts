import { Contract, JsonRpcProvider, NonceManager, Wallet, ZeroHash } from "ethers";
import { Seaport } from "@opensea/seaport-js";
import { ItemType } from "@opensea/seaport-js/lib/constants.js";
import { describe, expect, it } from "vitest";
import { CANONICAL } from "../../src/config.js";

const pool = CANONICAL.bemUsdtPool;
const router = "0x1b81D678ffb9C0263b24A97847620C99d213eB14";
const quoter = "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997";
const erc20Abi = ["function balanceOf(address) view returns(uint256)", "function allowance(address,address) view returns(uint256)", "function transfer(address,uint256) returns(bool)", "function approve(address,uint256) returns(bool)"];
const quoterAbi = ["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"];
const routerAbi = ["function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns(uint256 amountOut)"];

async function fundedFork() {
  const provider = new JsonRpcProvider(process.env.BSC_FORK_RPC_URL);
  expect((await provider.getNetwork()).chainId).toBe(56n);
  const sellerWallet = Wallet.createRandom().connect(provider); const buyerWallet = Wallet.createRandom().connect(provider); const feeRecipient = Wallet.createRandom().connect(provider);
  await Promise.all([sellerWallet.address, buyerWallet.address, feeRecipient.address, pool].map((account) => provider.send("anvil_setBalance", [account, "0x56BC75E2D63100000"])));
  await provider.send("anvil_impersonateAccount", [pool]);
  const poolSigner = await provider.getSigner(pool); const bemFromPool = new Contract(CANONICAL.bemToken, erc20Abi, poolSigner); const usdtFromPool = new Contract(CANONICAL.usdtToken, erc20Abi, poolSigner);
  await (await bemFromPool.getFunction("transfer")(sellerWallet.address, 500_000_000n)).wait();
  await (await bemFromPool.getFunction("transfer")(buyerWallet.address, 200_000_000n)).wait();
  await (await usdtFromPool.getFunction("transfer")(buyerWallet.address, 100n * 10n ** 18n)).wait();
  await provider.send("anvil_stopImpersonatingAccount", [pool]);
  return { provider, sellerWallet, buyerWallet, feeRecipient };
}

describe.skipIf(!process.env.BSC_FORK_RPC_URL)("BEM Market V1 fork", () => {
  it("partially fills, fully fills and cancels a BEM/USDT ERC20 AdvancedOrder", async () => {
    const { provider, sellerWallet, buyerWallet, feeRecipient } = await fundedFork(); const seller = new NonceManager(sellerWallet); const buyer = new NonceManager(buyerWallet);
    const sellerBem = new Contract(CANONICAL.bemToken, erc20Abi, seller); const buyerUsdt = new Contract(CANONICAL.usdtToken, erc20Abi, buyer);
    await (await sellerBem.getFunction("approve")(CANONICAL.seaport, 200_000_000n)).wait(); await (await buyerUsdt.getFunction("approve")(CANONICAL.seaport, 21n * 10n ** 18n)).wait();
    const sellerSeaport = new Seaport(seller as never, { overrides: { contractAddress: CANONICAL.seaport, seaportVersion: "1.6", defaultConduitKey: ZeroHash } });
    const buyerSeaport = new Seaport(buyer as never, { overrides: { contractAddress: CANONICAL.seaport, seaportVersion: "1.6", defaultConduitKey: ZeroHash } });
    const now = Number((await provider.getBlock("latest"))!.timestamp);
    async function order(amount = 200_000_000n) {
      const sellerTotal = amount / 100_000_000n * 10n * 10n ** 18n; const fee = sellerTotal / 100n;
      const useCase = await sellerSeaport.createOrder({ offer: [{ itemType: ItemType.ERC20, token: CANONICAL.bemToken, identifier: "0", amount: amount.toString() }], consideration: [{ itemType: ItemType.ERC20, token: CANONICAL.usdtToken, identifier: "0", amount: sellerTotal.toString(), recipient: sellerWallet.address }, { itemType: ItemType.ERC20, token: CANONICAL.usdtToken, identifier: "0", amount: fee.toString(), recipient: feeRecipient.address }], allowPartialFills: true, restrictedByZone: false, conduitKey: ZeroHash, startTime: String(now - 30), endTime: String(now + 86_400) } as never, sellerWallet.address);
      const create = useCase.actions.find((action) => action.type === "create"); if (!create || !("createOrder" in create)) throw new Error("Missing create action"); return create.createOrder();
    }
    const signed = await order(); const hash = sellerSeaport.getOrderHash(signed.parameters); const sellerBefore = await provider.getBalance(sellerWallet.address); void sellerBefore;
    const sellerUsdt = new Contract(CANONICAL.usdtToken, erc20Abi, provider); const feeBefore = await sellerUsdt.getFunction("balanceOf")(feeRecipient.address); const proceedsBefore = await sellerUsdt.getFunction("balanceOf")(sellerWallet.address);
    const first = await buyerSeaport.fulfillOrder({ order: signed, unitsToFill: 100_000_000n, accountAddress: buyerWallet.address, conduitKey: ZeroHash }); const firstAction = first.actions.find((action) => action.type === "exchange"); if (!firstAction) throw new Error("Missing AdvancedOrder exchange"); const firstBuilt = await firstAction.transactionMethods.buildTransaction(); expect(BigInt(firstBuilt.value?.toString() ?? "0")).toBe(0n); await firstAction.transactionMethods.staticCall(); await (await firstAction.transactionMethods.transact()).wait();
    expect(await sellerUsdt.getFunction("balanceOf")(sellerWallet.address)).toBe(proceedsBefore + 10n * 10n ** 18n); expect(await sellerUsdt.getFunction("balanceOf")(feeRecipient.address)).toBe(feeBefore + 10n ** 17n); const partial = await sellerSeaport.getOrderStatus(hash); expect(partial.totalFilled).toBeLessThan(partial.totalSize);
    const rest = await buyerSeaport.fulfillOrder({ order: signed, unitsToFill: 100_000_000n, accountAddress: buyerWallet.address, conduitKey: ZeroHash }); const restAction = rest.actions.find((action) => action.type === "exchange"); if (!restAction) throw new Error("Missing AdvancedOrder exchange"); await (await restAction.transactionMethods.transact()).wait(); const filled = await sellerSeaport.getOrderStatus(hash); expect(filled.totalFilled).toBe(filled.totalSize);
    const cancellable = await order(100_000_000n); await sellerSeaport.cancelOrders([cancellable.parameters], sellerWallet.address).staticCall(); await (await sellerSeaport.cancelOrders([cancellable.parameters], sellerWallet.address).transact()).wait(); expect((await sellerSeaport.getOrderStatus(sellerSeaport.getOrderHash(cancellable.parameters))).isCancelled).toBe(true);
  }, 180_000);

  it("quotes and executes exact-input Buy BEM and Sell BEM through the fixed V3 pool", async () => {
    const { provider, buyerWallet } = await fundedFork(); const buyer = new NonceManager(buyerWallet); const usdt = new Contract(CANONICAL.usdtToken, erc20Abi, buyer); const bem = new Contract(CANONICAL.bemToken, erc20Abi, buyer); const quote = new Contract(quoter, quoterAbi, provider); const swap = new Contract(router, routerAbi, buyer);
    const oneUsdt = 10n ** 18n; await (await usdt.getFunction("approve")(router, oneUsdt)).wait(); const buy = await quote.getFunction("quoteExactInputSingle").staticCall({ tokenIn: CANONICAL.usdtToken, tokenOut: CANONICAL.bemToken, amountIn: oneUsdt, fee: 100, sqrtPriceLimitX96: 0 }); expect(buy[0]).toBeGreaterThan(0n); const bemBefore = await bem.getFunction("balanceOf")(buyerWallet.address); await (await swap.getFunction("exactInputSingle")({ tokenIn: CANONICAL.usdtToken, tokenOut: CANONICAL.bemToken, fee: 100, recipient: buyerWallet.address, amountIn: oneUsdt, amountOutMinimum: buy[0] * 99n / 100n, sqrtPriceLimitX96: 0 }, { value: 0 })).wait(); expect(await bem.getFunction("balanceOf")(buyerWallet.address)).toBeGreaterThan(bemBefore);
    const oneBem = 100_000_000n; await (await bem.getFunction("approve")(router, oneBem)).wait(); const sell = await quote.getFunction("quoteExactInputSingle").staticCall({ tokenIn: CANONICAL.bemToken, tokenOut: CANONICAL.usdtToken, amountIn: oneBem, fee: 100, sqrtPriceLimitX96: 0 }); expect(sell[0]).toBeGreaterThan(0n); const usdtBefore = await usdt.getFunction("balanceOf")(buyerWallet.address); await (await swap.getFunction("exactInputSingle")({ tokenIn: CANONICAL.bemToken, tokenOut: CANONICAL.usdtToken, fee: 100, recipient: buyerWallet.address, amountIn: oneBem, amountOutMinimum: sell[0] * 99n / 100n, sqrtPriceLimitX96: 0 }, { value: 0 })).wait(); expect(await usdt.getFunction("balanceOf")(buyerWallet.address)).toBeGreaterThan(usdtBefore);
  }, 180_000);
});
