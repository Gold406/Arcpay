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

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`ArcPay backend running on http://localhost:${PORT}`);
});

