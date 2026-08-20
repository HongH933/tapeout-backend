import { Contract, Interface, JsonRpcProvider, NonceManager, Wallet } from "ethers";
import { describe, expect, it } from "vitest";
import { Seaport } from "@opensea/seaport-js";
import { CANONICAL } from "../../src/config.js";

const erc1155Abi = ["function balanceOf(address,uint256) view returns(uint256)", "function isApprovedForAll(address,address) view returns(bool)", "function setApprovalForAll(address,bool)", "function safeTransferFrom(address,address,uint256,uint256,bytes)"];
const holder = "0x00d8a06cc7afd1ff05fd65639520126f475f1a65";
const transistors = "0xCC42ba5De07f01B472a5b14cF45aBcCA79Eb8087";

describe.skipIf(!process.env.BSC_FORK_RPC_URL)("BSC fork Seaport lifecycle", () => {
  it("uses real forked Seaport to partially fill, fully fill, and cancel", async () => {
    const provider = new JsonRpcProvider(process.env.BSC_FORK_RPC_URL);
    const seller = Wallet.createRandom().connect(provider); const buyer = Wallet.createRandom().connect(provider); const feeRecipient = Wallet.createRandom().connect(provider);
    const sellerSigner = new NonceManager(seller); const buyerSigner = new NonceManager(buyer);
    await Promise.all([seller.address, buyer.address, feeRecipient.address].map((account) => provider.send("anvil_setBalance", [account, "0x56BC75E2D63100000"])));
    expect((await provider.getNetwork()).chainId).toBe(56n);
    expect((await provider.getCode(CANONICAL.seaport)).length).toBeGreaterThan(2);
    expect((await provider.getCode(transistors)).length).toBeGreaterThan(2);
    await provider.send("anvil_impersonateAccount", [holder]); await provider.send("anvil_setBalance", [holder, "0x56BC75E2D63100000"]);
    const holderToken = new Contract(transistors, erc1155Abi, await provider.getSigner(holder));
    const sellerToken = new Contract(transistors, erc1155Abi, sellerSigner);
    const buyerToken = new Contract(transistors, erc1155Abi, buyerSigner);
    const balanceOf = (contract: Contract, address: string) => contract.getFunction("balanceOf")(address, 1n) as Promise<bigint>;
    const nativeBalance = async (address: string) => BigInt(await provider.send("eth_getBalance", [address, "latest"]));
    expect(await balanceOf(holderToken, holder)).toBeGreaterThanOrEqual(5n);
    await (await holderToken.getFunction("safeTransferFrom")(holder, seller.address, 1n, 5n, "0x", { gasLimit: 500_000n })).wait();
    expect(await balanceOf(sellerToken, seller.address)).toBe(5n);
    await (await sellerToken.getFunction("setApprovalForAll")(CANONICAL.seaport, true, { gasLimit: 500_000n })).wait();
    expect(await sellerToken.getFunction("isApprovedForAll")(seller.address, CANONICAL.seaport)).toBe(true);

    // seaport-js currently exposes CJS-flavoured ethers types under NodeNext. The runtime
    // signers are ethers v6 JsonRpcSigner instances; keep this cast confined to the test.
    const sellerSeaport = new Seaport(sellerSigner as never, { overrides: { contractAddress: CANONICAL.seaport, seaportVersion: "1.6", defaultConduitKey: "0x".padEnd(66, "0") } });
    const buyerSeaport = new Seaport(buyerSigner as never, { overrides: { contractAddress: CANONICAL.seaport, seaportVersion: "1.6", defaultConduitKey: "0x".padEnd(66, "0") } });
    const unit = 100_000_000_000_000n; const feeUnit = unit / 100n;
    const now = Number((await provider.getBlock("latest"))!.timestamp);
    async function signOrder(quantity: bigint) {
      const useCase = await sellerSeaport.createOrder({ offer: [{ itemType: 3, token: transistors, identifier: "1", amount: quantity.toString() }], consideration: [{ amount: (unit * quantity).toString(), recipient: seller.address }, { amount: (feeUnit * quantity).toString(), recipient: feeRecipient.address }], allowPartialFills: true, restrictedByZone: false, startTime: String(now - 30), endTime: String(now + 86_400), conduitKey: "0x".padEnd(66, "0") }, seller.address);
      expect(useCase.actions.filter((action) => action.type === "approval")).toHaveLength(0);
      const create = useCase.actions.find((action) => action.type === "create");
      if (!create || !("createOrder" in create)) throw new Error("Missing create action");
      return create.createOrder();
    }
    const order = await signOrder(4n); const orderHash = sellerSeaport.getOrderHash(order.parameters); const sellerBefore = await nativeBalance(seller.address); const feeBefore = await nativeBalance(feeRecipient.address);
    const first = await buyerSeaport.fulfillOrder({ order, unitsToFill: 1n, accountAddress: buyer.address, conduitKey: "0x".padEnd(66, "0"), overrides: { nonce: 0 } });
    const firstExchange = first.actions.find((action) => action.type === "exchange"); if (!firstExchange) throw new Error("Expected fulfillment transaction");
    const firstTransaction = await buyer.sendTransaction({ ...(await firstExchange.transactionMethods.buildTransaction()), nonce: 0 }); await firstTransaction.wait();
    buyerSigner.reset();
    expect(await balanceOf(sellerToken, seller.address)).toBe(4n); expect(await balanceOf(buyerToken, buyer.address)).toBe(1n); expect(await nativeBalance(seller.address) - sellerBefore).toBe(unit); expect(await nativeBalance(feeRecipient.address) - feeBefore).toBe(feeUnit);
    const partialStatus = await sellerSeaport.getOrderStatus(orderHash); expect(partialStatus.totalFilled).toBe(1n); expect(partialStatus.totalSize).toBe(4n);
    const second = await buyerSeaport.fulfillOrder({ order, unitsToFill: 3n, accountAddress: buyer.address, conduitKey: "0x".padEnd(66, "0"), overrides: { nonce: 1 } });
    const secondExchange = second.actions.find((action) => action.type === "exchange"); if (!secondExchange) throw new Error("Expected fulfillment transaction");
    const secondTransaction = await buyer.sendTransaction({ ...(await secondExchange.transactionMethods.buildTransaction()), nonce: 1 }); await secondTransaction.wait(); const filled = await sellerSeaport.getOrderStatus(orderHash); expect(filled.totalFilled).toBe(filled.totalSize); expect(await balanceOf(sellerToken, seller.address)).toBe(1n); expect(await balanceOf(buyerToken, buyer.address)).toBe(4n); expect(await nativeBalance(seller.address) - sellerBefore).toBe(unit * 4n); expect(await nativeBalance(feeRecipient.address) - feeBefore).toBe(feeUnit * 4n);
    const cancelOrder = await signOrder(1n); await sellerSeaport.cancelOrders([cancelOrder.parameters], seller.address).staticCall(); await (await sellerSeaport.cancelOrders([cancelOrder.parameters], seller.address).transact()).wait(); const cancelHash = sellerSeaport.getOrderHash(cancelOrder.parameters); expect((await sellerSeaport.getOrderStatus(cancelHash)).isCancelled).toBe(true);
    await expect(buyerSeaport.fulfillOrder({ order: cancelOrder, unitsToFill: 1n, accountAddress: buyer.address, conduitKey: "0x".padEnd(66, "0") })).rejects.toThrow();
    await provider.send("anvil_stopImpersonatingAccount", [holder]);
  }, 120_000);

  it("fills three listings in one fulfillOrders transaction and benchmarks safe batch sizes", async () => {
    const provider = new JsonRpcProvider(process.env.BSC_FORK_RPC_URL); expect((await provider.getNetwork()).chainId).toBe(56n);
    const buyerWallet = Wallet.createRandom().connect(provider); const buyer = new NonceManager(buyerWallet); const feeRecipient = Wallet.createRandom().connect(provider);
    const sellerWallets = [Wallet.createRandom().connect(provider), Wallet.createRandom().connect(provider), Wallet.createRandom().connect(provider)]; const sellers = sellerWallets.map((wallet) => new NonceManager(wallet));
    await Promise.all([buyerWallet.address, feeRecipient.address, ...sellerWallets.map((wallet) => wallet.address)].map((account) => provider.send("anvil_setBalance", [account, "0x56BC75E2D63100000"])));
    await provider.send("anvil_impersonateAccount", [holder]); await provider.send("anvil_setBalance", [holder, "0x56BC75E2D63100000"]); const holderToken = new Contract(transistors, erc1155Abi, await provider.getSigner(holder));
    for (let index = 0; index < sellers.length; index += 1) { await (await holderToken.getFunction("safeTransferFrom")(holder, sellerWallets[index]!.address, 1n, index === 2 ? 30n : 5n, "0x", { gasLimit: 500_000n })).wait(); const tokenContract = new Contract(transistors, erc1155Abi, sellers[index]!); await (await tokenContract.getFunction("setApprovalForAll")(CANONICAL.seaport, true, { gasLimit: 500_000n })).wait(); }
    const seaports = sellers.map((seller) => new Seaport(seller as never, { overrides: { contractAddress: CANONICAL.seaport, seaportVersion: "1.6", defaultConduitKey: "0x".padEnd(66, "0") } })); const buyerSeaport = new Seaport(buyer as never, { overrides: { contractAddress: CANONICAL.seaport, seaportVersion: "1.6", defaultConduitKey: "0x".padEnd(66, "0") } });
    const latest = await provider.getBlock("latest"); const now = Number(latest!.timestamp); const gasLimit = latest!.gasLimit;
    async function create(index: number, quantity: bigint, unit: bigint) { const sellerAddress = sellerWallets[index]!.address; const useCase = await seaports[index]!.createOrder({ offer: [{ itemType: 3, token: transistors, identifier: "1", amount: quantity.toString() }], consideration: [{ amount: (unit * quantity).toString(), recipient: sellerAddress }, { amount: (unit / 100n * quantity).toString(), recipient: feeRecipient.address }], allowPartialFills: true, restrictedByZone: false, startTime: String(now - 30), endTime: String(now + 86_400), conduitKey: "0x".padEnd(66, "0") }, sellerAddress); const action = useCase.actions.find((candidate) => candidate.type === "create"); if (!action || !("createOrder" in action)) throw new Error("Missing create action"); return action.createOrder(); }
    const orders = await Promise.all([create(0, 2n, 100_000_000_000_000n), create(1, 3n, 200_000_000_000_000n), create(2, 4n, 300_000_000_000_000n)]); const quantities = [2n, 3n, 1n];
    const sellerBefore = await Promise.all(sellerWallets.map((wallet) => provider.getBalance(wallet.address))); const feeBefore = await provider.getBalance(feeRecipient.address); const buyerToken = new Contract(transistors, erc1155Abi, buyer);
    const batch = await buyerSeaport.fulfillOrders({ fulfillOrderDetails: orders.map((order, index) => ({ order, unitsToFill: quantities[index]! })), accountAddress: buyerWallet.address, conduitKey: "0x".padEnd(66, "0") }); const exchangeActions = batch.actions.filter((action) => action.type === "exchange"); expect(batch.actions).toHaveLength(1); expect(exchangeActions).toHaveLength(1); const exchange = exchangeActions[0]!;
    const staticStart = performance.now(); await exchange.transactionMethods.staticCall(); const staticMs = performance.now() - staticStart; const estimateStart = performance.now(); const estimatedGas = await exchange.transactionMethods.estimateGas(); const estimateMs = performance.now() - estimateStart; expect(estimatedGas * 10n).toBeLessThan(gasLimit * 7n);
    const built = await exchange.transactionMethods.buildTransaction(); const calldataBytes = ((built.data?.toString().length ?? 2) - 2) / 2; const transaction = await exchange.transactionMethods.transact(); const receipt = await transaction.wait(); expect(receipt?.hash).toBe(transaction.hash);
    const fulfilledTopic = new Interface(["event OrderFulfilled(bytes32 orderHash,address indexed offerer,address indexed zone,address recipient,(uint8 itemType,address token,uint256 identifier,uint256 amount)[] offer,(uint8 itemType,address token,uint256 identifier,uint256 amount,address recipient)[] consideration)"]).getEvent("OrderFulfilled")!.topicHash; const fulfilledLogs = receipt!.logs.filter((log) => log.topics[0] === fulfilledTopic); expect(fulfilledLogs.length).toBeGreaterThanOrEqual(3);
    expect(await buyerToken.getFunction("balanceOf")(buyerWallet.address, 1n)).toBe(6n); const units = [100_000_000_000_000n * 2n, 200_000_000_000_000n * 3n, 300_000_000_000_000n]; for (let index = 0; index < 3; index += 1) expect((await provider.getBalance(sellerWallets[index]!.address)) - sellerBefore[index]!).toBe(units[index]); expect((await provider.getBalance(feeRecipient.address)) - feeBefore).toBe(units.reduce((sum, value) => sum + value / 100n, 0n));
    const statuses = await Promise.all(orders.map((order, index) => seaports[index]!.getOrderStatus(seaports[index]!.getOrderHash(order.parameters)))); expect(statuses[0]!.totalFilled).toBe(statuses[0]!.totalSize); expect(statuses[1]!.totalFilled).toBe(statuses[1]!.totalSize); expect(statuses[2]!.totalFilled).toBe(1n); expect(statuses[2]!.totalSize).toBe(4n);
    const benchmarkOrders = await Promise.all(Array.from({ length: 20 }, (_, index) => create(2, 1n, 400_000_000_000_000n + BigInt(index) * 10_000_000_000_000n))); const benchmark: Array<{ orders: number; gas: bigint; calldataBytes: number; staticMs: number; estimateMs: number }> = [];
    for (const count of [1, 3, 5, 10, 20]) { const useCase = await buyerSeaport.fulfillOrders({ fulfillOrderDetails: benchmarkOrders.slice(0, count).map((order) => ({ order, unitsToFill: 1n })), accountAddress: buyerWallet.address, conduitKey: "0x".padEnd(66, "0") }); const action = useCase.actions.find((candidate) => candidate.type === "exchange"); if (!action) throw new Error("Missing batch exchange action"); const startStatic = performance.now(); await action.transactionMethods.staticCall(); const elapsedStatic = performance.now() - startStatic; const startEstimate = performance.now(); const gas = await action.transactionMethods.estimateGas(); const elapsedEstimate = performance.now() - startEstimate; const request = await action.transactionMethods.buildTransaction(); benchmark.push({ orders: count, gas, calldataBytes: ((request.data?.toString().length ?? 2) - 2) / 2, staticMs: elapsedStatic, estimateMs: elapsedEstimate }); expect(gas * 10n).toBeLessThan(gasLimit * 7n); }
    expect(benchmark.map((entry) => entry.orders)).toEqual([1, 3, 5, 10, 20]); expect(staticMs).toBeGreaterThanOrEqual(0); expect(estimateMs).toBeGreaterThanOrEqual(0); expect(calldataBytes).toBeGreaterThan(0); await provider.send("anvil_stopImpersonatingAccount", [holder]);
  }, 300_000);
});
