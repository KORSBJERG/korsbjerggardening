import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const source=await readFile('dist/server/index.js','utf8');const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
const ui=await readFile('worker/ui.html','utf8');new Function(ui.match(/<script>([\s\S]*)<\/script>/)[1]);
const records=new Map();const bucket={async get(k){const x=records.get(k);return x?{etag:x.etag,json:async()=>JSON.parse(x.raw)}:null},async put(k,raw,opts){const old=records.get(k);if(opts.onlyIf.etagMatches&&old?.etag!==opts.onlyIf.etagMatches)return null;if(opts.onlyIf.etagDoesNotMatch==='*'&&old)return null;const etag=crypto.randomUUID();records.set(k,{raw,etag});return {etag}}};
const call=(method,user='owner',body=null,origin='https://test.example')=>worker.fetch(new Request('https://test.example/api/state',{method,headers:{...(user?{'oai-authenticated-user-id':user}:{}),origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),{BUCKET:bucket});
assert.equal((await call('GET',null)).status,401);assert.equal((await call('PUT','owner',{state:{}},'https://evil.example')).status,403);
assert.deepEqual(await (await call('GET')).json(),{state:null,etag:null});
const state={tasks:[],gardens:[],logs:[],messages:[]};let res=await call('PUT','owner',{state,etag:null});assert.equal(res.status,200);const {etag}=await res.json();
assert.deepEqual((await (await call('GET')).json()).state,state);assert.equal((await call('PUT','owner',{state,etag:null})).status,409);assert.equal((await call('PUT','owner',{state,etag:'stale'})).status,409);assert.equal((await call('PUT','owner',{state,etag})).status,200);
assert.equal((await (await call('GET','other-user')).json()).state,null);assert.equal((await call('PUT','owner',{state:{}})).status,400);
for(const path of ['/kontor','/app']){const r=await worker.fetch(new Request('https://test.example'+path),{});assert.equal(r.status,200);assert.match(await r.text(),/Antons Korsbjerg/)}
console.log('PASS: UI syntax; admin and portal routes; identity required; origin protection; persistent round-trip; conflict detection; per-user isolation; malformed data rejected.');
