require('dotenv').config();

const TOKEN_MESSENGER_V2 = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA';
const USDC_ON_ARC = '0x3600000000000000000000000000000000000000';
const MESSAGE_TRANSMITTER_SEPOLIA = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275';
const ETH_SEPOLIA_DOMAIN = 0;
const ARC_DOMAIN = 26;
const SEPOLIA_RECIPIENT = '0xaafd0965f207c949cb4896bb993701bb0d40d576';
const SEPOLIA_WALLET_ID = '22d4f072-b405-554c-a3dc-dc7602cf972e';

function addressToBytes32(address) {
  const stripped = address.replace(/^0x/, '').toLowerCase();
  return '0x' + stripped.padStart(64, '0');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = function registerBridgeRoute(app, client) {
  const bridgeStatus = {};

  async function waitForComplete(txId) {
    for (let i = 0; i < 60; i++) {
      await sleep(3000);
      const res = await client.getTransaction({ id: txId });
      const state = res.data.transaction.state;
      if (state === 'COMPLETE') return res.data.transaction;
      if (state === 'FAILED') throw new Error('Transaction failed: ' + JSON.stringify(res.data.transaction.errorReason));
    }
    throw new Error('Transaction did not confirm within timeout');
  }

  app.post('/bridge', async (req, res) => {
    const { amount } = req.body;
    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const bridgeId = 'bridge_' + Date.now();
    bridgeStatus[bridgeId] = { stage: 'approving', error: null };
    res.json({ bridgeId });

    (async () => {
      try {
        const amountBaseUnits = String(Math.round(parseFloat(amount) * 1000000));

        bridgeStatus[bridgeId].stage = 'approving';
        const approveTx = await client.createContractExecutionTransaction({
          walletId: process.env.WALLET_ID,
          contractAddress: USDC_ON_ARC,
          abiFunctionSignature: 'approve(address,uint256)',
          abiParameters: [TOKEN_MESSENGER_V2, amountBaseUnits],
          fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
        });
        await waitForComplete(approveTx.data.id);

        bridgeStatus[bridgeId].stage = 'burning';
        const recipientBytes32 = addressToBytes32(SEPOLIA_RECIPIENT);
        const destinationCallerBytes32 = '0x' + '0'.repeat(64);
        const burnTx = await client.createContractExecutionTransaction({
          walletId: process.env.WALLET_ID,
          contractAddress: TOKEN_MESSENGER_V2,
          abiFunctionSignature: 'depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)',
          abiParameters: [amountBaseUnits, ETH_SEPOLIA_DOMAIN, recipientBytes32, USDC_ON_ARC, destinationCallerBytes32, '0', '2000'],
          fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
        });
        const confirmedBurn = await waitForComplete(burnTx.data.id);
        bridgeStatus[bridgeId].burnTxHash = confirmedBurn.txHash;

        bridgeStatus[bridgeId].stage = 'attesting';
        let attestationData = null;
        for (let i = 0; i < 60; i++) {
          await sleep(3000);
          const attResp = await fetch('https://iris-api-sandbox.circle.com/v2/messages/' + ARC_DOMAIN + '?transactionHash=' + confirmedBurn.txHash);
          const attJson = await attResp.json();
          if (attJson.messages && attJson.messages[0] && attJson.messages[0].status === 'complete') {
            attestationData = attJson.messages[0];
            break;
          }
        }
        if (!attestationData) throw new Error('Attestation timed out');

        bridgeStatus[bridgeId].stage = 'minting';
        const mintTx = await client.createContractExecutionTransaction({
          walletId: SEPOLIA_WALLET_ID,
          contractAddress: MESSAGE_TRANSMITTER_SEPOLIA,
          abiFunctionSignature: 'receiveMessage(bytes,bytes)',
          abiParameters: [attestationData.message, attestationData.attestation],
          fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
        });
        const confirmedMint = await waitForComplete(mintTx.data.id);

        bridgeStatus[bridgeId].stage = 'complete';
        bridgeStatus[bridgeId].mintTxHash = confirmedMint.txHash;
      } catch (err) {
        bridgeStatus[bridgeId].stage = 'error';
        bridgeStatus[bridgeId].error = err.message;
      }
    })();
  });

  app.get('/bridge/:id', (req, res) => {
    const status = bridgeStatus[req.params.id];
    if (!status) return res.status(404).json({ error: 'Bridge ID not found' });
    res.json(status);
  });
};
