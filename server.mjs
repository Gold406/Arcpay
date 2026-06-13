import http from 'http';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

const PORT = 8080;
const API_KEY = 'TEST_API_KEY:342bb100f3a5fd81ab1b486d6fb335ff:2d2f691ff49d2ae495277693ace471cb';
const WALLET_ID = '829cdd05-a7c6-5c68-baf4-f5842d2e2905';
const USDC_TOKEN = 'ef87c8c3-85de-598a-af50-c5135eecfa74';
const ENTITY_SECRET = '23b428d4b120157e5017413c6eae44293c345ce27f23d23b48d91870b1b0c763';
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAo6OFbq67E1T0M4c4ILg6
rbn72yHRBBQi73T2m2iqyUAXbL6GDJsFCVvsVOcCXxRE2AGe9VVK8EORiQ14Ml1Z
6PGMMYaImzjRRczEsimEqQAlq4jBr1HyB06BKj/FvB/ltqymOSDGtL/uucbJDE7f
r6BIQBbKxrSLx/uQI0L/uhw1JrFPtso+EF3BQmKSYhmoedCtJk/uPNeUgIyW4Ldv
wOumVbXdZvSnDjT4aZ7ZieB0Pa6Y5tD8ZzjCLPNfKAsmYToMfWuZxw2aBjmbaUYV
5G7XFFNa1//S+eY76/pwsh8Z9P5biaJpL57gxfW97+hir7/cGZfPHYPqb6e4qG/i
ZNHKeykgEAXXbUXr3eYZQRHXDBnG+/bLXazslnh1pyastQsOW7+Gm39IcLX2T/Eo
aIHYn8MZsKtKKB4z9pj0B3ctN/GGnLPDLX8fos/rqu4URWeJEnBvPRQqMi09l4bT
hrrq0dzwQHXn4sIPeUl5b076Ep5/q2eHWxeyYRDIXmnqTkrdBF+Wvktov8xNdz8o
+wKNkrI7p13znt2EzDXle6Bnm23aDKuylO1+oLM+QK20pr+MCYOsrPto+03CB2mW
qtbXnQ2zZgGo1dt9lUjeYucNhlga9uy3laOm0un8zq2vMd3qz5DUD/LoIauHQqsO
I4bW/pUeffJFiXGtGhy7eP8CAwEAAQ==
-----END PUBLIC KEY-----`;

function generateCiphertext() {
  const secretBuffer = Buffer.from(ENTITY_SECRET, 'hex');
  const encrypted = crypto.publicEncrypt(
    {key: PUBLIC_KEY, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256'},
    secretBuffer
  );
  return encrypted.toString('base64');
}

const merchants = {
  john: {name:'John Coffee Shop', address:'0x8e9348FA2134Cf87933a2De8a3EDEA780959650D'},
  mary: {name:'Mary Restaurant', address:'0xB9c6AF6cB0bCc48ae361E9A13679Ca9198da5398'},
  mike: {name:'Mike Grocery', address:'0x11111f8713044a7831049220132813c0eb997df7'}
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  if(req.method==='GET' && req.url==='/'){
    res.writeHead(200,{'Content-Type':'text/html'});
    res.end(fs.readFileSync('./index.html'));
    return;
  }
  if(req.method==='GET' && req.url==='/api/merchants'){
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify(merchants));
    return;
  }
  if(req.method==='GET' && req.url==='/api/balance'){
    try {
      const data = await new Promise((resolve,reject)=>{
        const r = https.request({
          hostname:'api.circle.com',
          path:'/v1/w3s/wallets/'+WALLET_ID+'/balances',
          method:'GET',
          headers:{'Authorization':'Bearer '+API_KEY}
        },(response)=>{
          let d='';
          response.on('data',c=>d+=c);
          response.on('end',()=>resolve(JSON.parse(d)));
        });
        r.on('error',reject);
        r.end();
      });
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify(data.data||{}));
    } catch(e){
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({tokenBalances:[]}));
    }
    return;
  }
  if(req.method==='POST' && req.url==='/api/pay'){
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',async()=>{
      try {
        const {merchantKey,amount} = JSON.parse(body);
        const merchant = merchants[merchantKey];
        const ciphertext = generateCiphertext();
        const payload = JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          amounts:[amount.toString()],
          destinationAddress: merchant.address,
          feeLevel:'HIGH',
          tokenId: USDC_TOKEN,
          walletId: WALLET_ID,
          entitySecretCiphertext: ciphertext
        });
        const data = await new Promise((resolve,reject)=>{
          const r = https.request({
            hostname:'api.circle.com',
            path:'/v1/w3s/developer/transactions/transfer',
            method:'POST',
            headers:{
              'Authorization':'Bearer '+API_KEY,
              'Content-Type':'application/json',
              'Content-Length':Buffer.byteLength(payload)
            }
          },(response)=>{
            let d='';
            response.on('data',c=>d+=c);
            response.on('end',()=>resolve(JSON.parse(d)));
          });
          r.on('error',reject);
          r.write(payload);
          r.end();
        });
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify(data.data||data));
      } catch(e){
        res.writeHead(500,{'Content-Type':'application/json'});
        res.end(JSON.stringify({error:e.message}));
      }
    });
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT,()=>console.log('ArcPay running on port '+PORT));
