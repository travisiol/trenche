const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const { Keypair } = require('@solana/web3.js');

function compile(file, overrides = {}) {
  const filename = path.resolve(file);
  const m = new Module(filename, module);
  m.filename = filename; m.paths = Module._nodeModulePaths(path.dirname(filename));
  const fallback = m.require.bind(m);
  m.require = (name) => Object.prototype.hasOwnProperty.call(overrides, name) ? overrides[name] : fallback(name);
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
  return m.exports;
}
const pure = compile('src/lib/husher.ts');

function setup() {
  const a = Keypair.generate().publicKey.toBase58(), b = Keypair.generate().publicKey.toBase58();
  const st = { dir: '/unused-husher-test', runtime: {}, settings: { cluster: 'mainnet', husherKey: 'test-secret-not-real' } };
  let saved = [], calls = [];
  class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const api = compile('src/server/husher.ts', {
    './api': { HttpError }, './wallets': { ownedAddresses: () => [a,b] }, '@/lib/husher': pure,
    './store': { store: () => st, readJson: () => structuredClone(saved), writeJson: (_p, value) => { saved = structuredClone(value); }, logActivity: () => {} },
  });
  const plan = { totalSol: '0.06', recipients: [{ address:a,label:'dev 1',sol:'0.03' },{ address:b,label:'dev 2',sol:'0.03' }] };
  const data = { send:'SOL',receive:'SOL',sendNetwork:'SOL',receiveNetwork:'SOL',totalAmount:0.06,status:'Awaiting Deposit',sendAddress:Keypair.generate().publicKey.toBase58(), recipients: [{recipientAddress:a,percent:'50',receiveAmount:'0.028925',status:'pending'},{recipientAddress:b,percent:'50',receiveAmount:'0.028925',status:'pending'}] };
  const quote = { totalReceiveAmount:'0.05785',recipients:[{success:true,sendAmount:'0.03',receiveAmount:'0.028925',rate:'0.96416666'},{success:true,sendAmount:'0.03',receiveAmount:'0.028925',rate:'0.96416666'}] };
  let behavior = async (url) => url.endsWith('/rate') ? quote : url.endsWith('/multi-exchange') ? {multiExchangeOrderId:'remote123',orderId:'short123'} : data;
  global.fetch = async (url, opts) => { calls.push({url,opts}); return new Response(JSON.stringify({success:true,data:await behavior(url,opts)}), {status:200,headers:{'content-type':'application/json'}}); };
  return { api,st,plan,data,quote,calls,setBehavior:(fn)=>behavior=fn, saved:()=>saved };
}

test('SOL splitting and allocation preserve exact totals, including rounding remainder', () => {
  const parts = pure.splitHusherSol('0.05',6);
  assert.equal(parts.reduce((n,s)=>n+pure.parseHusherSol(s),0n),50000000n);
  const percents = pure.husherAllocation({totalSol:'0.05',recipients:parts.map((sol)=>({sol}))});
  assert.ok(Math.abs(percents.reduce((a,b)=>a+b,0)-100)<1e-9);
  for (const bad of ['0','-1','1e-3','NaN','0.0000000001']) assert.throws(()=>pure.parseHusherSol(bad));
  assert.throws(()=>pure.husherAllocation({totalSol:'0.1',recipients:[{sol:'0.09'}]}),/exactly/);
});
test('live response shape is decoded; create is idempotent and stores verified deposit instructions', async () => {
  const t = setup(); const q = await t.api.husherQuote(t.plan);
  assert.equal(q.receiveSol,'0.05785');
  const order = await t.api.husherCreate(q.id,true);
  assert.equal(order.depositAddress,t.data.sendAddress);assert.equal(order.depositSol,'0.06');
  assert.equal(order.recipients.length,2);
  const again = await t.api.husherCreate(q.id,true);
  assert.equal(again.remoteId,order.remoteId);
  assert.equal(t.calls.filter(c=>c.url.endsWith('/multi-exchange')).length,1);
  assert.equal(t.calls[0].opts.headers['x-api-key'],'test-secret-not-real');
  assert.ok(!JSON.stringify(t.saved()).includes('test-secret-not-real'));
});
test('minimum failure, devnet, duplicate destinations and foreign addresses are rejected', async () => {
  const t=setup();
  t.setBehavior(async()=>({recipients:[{success:false,error:'Minimum 0.011 SOL'},{success:true}]}));
  await assert.rejects(t.api.husherQuote(t.plan),/Minimum/);
  const before=t.calls.length;t.st.settings.cluster='devnet';
  await assert.rejects(t.api.husherQuote(t.plan),/mainnet/);assert.equal(t.calls.length,before);
  t.st.settings.cluster='mainnet';
  await assert.rejects(t.api.husherQuote({...t.plan,recipients:[t.plan.recipients[0],t.plan.recipients[0]]}),/once/);
  await assert.rejects(t.api.husherQuote({...t.plan,recipients:[{...t.plan.recipients[0],address:Keypair.generate().publicKey.toBase58()},t.plan.recipients[1]]}),/vault/);
});
test('missing consent and expired quotes never create a remote order', async()=>{
  const t=setup();const q=await t.api.husherQuote(t.plan);
  await assert.rejects(t.api.husherCreate(q.id,false),/terms/);
  const date=Date.now;Date.now=()=>q.expiresAt+1;
  try {await assert.rejects(t.api.husherCreate(q.id,true),/expired/);}finally{Date.now=date;}
  assert.equal(t.calls.length,1);
});
test('ambiguous remote creation is retained and never retried automatically',async()=>{
  const t=setup(); const q=await t.api.husherQuote(t.plan);
  t.setBehavior(async()=>{throw new Error('timeout');});
  const failed=await t.api.husherCreate(q.id,true);assert.equal(failed.status,'Creation needs review');
  assert.equal(failed.depositAddress,null);
  await t.api.husherCreate(q.id,true);assert.equal(t.calls.length,2);
});
test('changed destinations or amount revoke previous deposit instructions',async()=>{
  const t=setup();const q=await t.api.husherQuote(t.plan);const order=await t.api.husherCreate(q.id,true);
  assert.ok(order.depositAddress);
  t.data.recipients[0].recipientAddress=Keypair.generate().publicKey.toBase58();
  const bad=await t.api.husherRefresh(order.id);assert.equal(bad.depositAddress,null);assert.match(bad.error,/destinations/);
});

test('changed allocation percentages revoke deposit instructions',async()=>{
  const t=setup();const q=await t.api.husherQuote(t.plan);const order=await t.api.husherCreate(q.id,true);
  assert.ok(order.depositAddress);t.data.recipients[0].percent='60';
  const bad=await t.api.husherRefresh(order.id);assert.equal(bad.depositAddress,null);assert.match(bad.error,/percentages/);
});
