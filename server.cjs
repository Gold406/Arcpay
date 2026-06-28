require('dotenv').config();
const express = require('express');
const cors = require('cors');

const sdk = require('@circle-fin/developer-controlled-wallets');
const client = sdk.initiateDeveloperControlledWalletsClient({
  apiKey: process.env.API_KEY,
  entitySecret: process.env.ENTITY_SECRET,
});

const app = express();
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

const MERCHANT_ADDRESS = '0x0860f2034d826783f49dab2a6927fb28f1bcee8a';

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ArcPay backend running' });
});

// Create a payment
app.post('/pay', async (req, res) => {
  const { amount } = req.body;

  if (!amount || isNaN(amount) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  try {
    const result = await client.createTransaction({
      walletId: process.env.WALLET_ID,
      tokenId: process.env.USDC_TOKEN_ID,
      destinationAddress: MERCHANT_ADDRESS,
      amount: [String(amount)],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });

    const rewardAmount = String(Math.floor(Number(amount) * 10) * 1e18);
    try {
      const payerWallet = await client.getWallet({ id: process.env.WALLET_ID });
      await client.createContractExecutionTransaction({
        walletId: process.env.WALLET_ID,
        contractAddress: "0x7edf0f3c0e39ba1caa3144a0e823aaebe247b729",
        abiFunctionSignature: "mintTo(address,uint256)",
        abiParameters: [payerWallet.data.wallet.address, rewardAmount],
        fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      });
      console.log("Reward mint SUCCESS, amount:", rewardAmount);
    } catch (rewardErr) {
      console.error("Reward mint failed (non-blocking):", rewardErr.message);
    }

    res.json({
      success: true,
      transactionId: result.data.id,
      state: result.data.state,
    });
  } catch (err) {
    console.error('Payment error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// Check transaction status
app.get('/status/:id', async (req, res) => {
  try {
    const result = await client.getTransaction({ id: req.params.id });
    const t = result.data.transaction;
    res.json({
      state: t.state,
      txHash: t.txHash,
      amount: t.amounts,
      networkFee: t.networkFee,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const registerBridgeRoute = require('./bridge-route.cjs');
registerBridgeRoute(app, client);


app.get('/transactions', async (req, res) => {
  try {
    const arcTxs = await client.listTransactions({ walletIds: [process.env.WALLET_ID] });
    const sepoliaTxs = await client.listTransactions({ walletIds: ['22d4f072-b405-554c-a3dc-dc7602cf972e'] });
  const combined = [...arcTxs.data.transactions, ...sepoliaTxs.data.transactions]
    .filter(t => t.state === 'COMPLETE')
    .sort((a, b) => new Date(b.updateDate) - new Date(a.updateDate));
  const seen = new Map();
  for (const t of combined) {
    const existing = seen.get(t.txHash);
    if (!existing || (t.amounts && t.amounts.length > 0)) {
      seen.set(t.txHash, t);
    }
  }
  const deduped = Array.from(seen.values()).slice(0, 10)
    .map(t => ({ txHash: t.txHash, blockchain: t.blockchain, amounts: t.amounts, updateDate: t.updateDate, abiFunctionSignature: t.abiFunctionSignature }));
    res.json({ transactions: deduped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/dashboard", async (req, res) => {
  try {
    const arcTxs = await client.listTransactions({ walletIds: [process.env.WALLET_ID] });
    const sepoliaTxs = await client.listTransactions({ walletIds: ["22d4f072-b405-554c-a3dc-dc7602cf972e"] });
    const all = [...arcTxs.data.transactions, ...sepoliaTxs.data.transactions].filter(t => t.state === "COMPLETE");
    const payments = all.filter(t => t.transactionType === "OUTBOUND" && t.destinationAddress === MERCHANT_ADDRESS && t.amounts && t.amounts.length > 0);
    const rewards = all.filter(t => t.contractAddress === "0x7edf0f3c0e39ba1caa3144a0e823aaebe247b729" && t.transactionType === "OUTBOUND");
    const totalRevenue = payments.reduce((sum, t) => sum + parseFloat(t.amounts[0] || 0), 0);
    const totalFees = all.reduce((sum, t) => sum + parseFloat(t.networkFee || 0), 0);
    const totalRewardsCount = rewards.length;
    res.json({
      totalRevenue: totalRevenue.toFixed(2),
      transactionCount: payments.length,
      averagePayment: payments.length ? (totalRevenue / payments.length).toFixed(2) : "0.00",
      totalGasFees: totalFees.toFixed(5),
      rewardsIssued: totalRewardsCount,
      recentPayments: payments.slice(0, 5).map(t => ({ amount: t.amounts[0], date: t.createDate, txHash: t.txHash, screened: !!(t.transactionScreeningEvaluation && t.transactionScreeningEvaluation.screeningDate) }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`ArcPay backend running on http://localhost:${PORT}`);
});


app.post('/swap', async (req, res) => {
  const { amount } = req.body;
  if (!amount || isNaN(amount) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  const DEMO_WALLET_ID = '9f04480b-a0df-5436-bafd-44000e887ebd';
  const DEMO_WALLET_ADDRESS = '0x4bd1814483dafc95c9ccb0f243ee04002edc68c5';
  const ARCP_CONTRACT = '0x7edf0f3c0e39ba1caa3144a0e823aaebe247b729';
  const RATE = 10;
  try {
    const usdcLeg = await client.createTransaction({
      walletId: DEMO_WALLET_ID,
      tokenId: process.env.USDC_TOKEN_ID,
      destinationAddress: MERCHANT_ADDRESS,
      amount: [String(amount)],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });
    const arcpAmount = String(Number(amount) * RATE * 1e18).split('.')[0];
    const arcpLeg = await client.createContractExecutionTransaction({
      walletId: process.env.WALLET_ID,
      contractAddress: ARCP_CONTRACT,
      abiFunctionSignature: 'transfer(address,uint256)',
      abiParameters: [DEMO_WALLET_ADDRESS, arcpAmount],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });
    res.json({
      success: true,
      usdcTransactionId: usdcLeg.data.id,
      arcpTransactionId: arcpLeg.data.id,
      rate: RATE,
      swapped: { usdcIn: amount, arcpOut: Number(amount) * RATE }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
