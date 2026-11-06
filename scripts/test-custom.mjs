import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {fixture,fixtureState} from './portal-test-support.mjs';
const f=await fixture();const anon=f.client(null);assert.equal((await anon.call('/api/state')).status,401);
const r=await f.owner.call('/api/state');const first=await r.json();assert.equal(r.status,200);assert.deepEqual(first.state.gardens,[]);
const state={...fixtureState(),gardens:[{id:'g1',name:'Have',customer:'Kunde',address:'Vej 1',area:100,budget:4}]};
assert.equal((await f.owner.call('/api/state','PUT',{state,etag:first.etag},{origin:'https://evil.test'})).status,403);
assert.equal((await f.owner.call('/api/state','PUT',{state,etag:first.etag},{'x-csrf-token':'wrong'})).status,403);
const saved=await f.owner.call('/api/state','PUT',{state,etag:first.etag});assert.equal(saved.status,200);const {etag}=await saved.json();assert.equal((await f.owner.call('/api/state','PUT',{state,etag:first.etag})).status,409);
assert.equal((await f.owner.call('/api/state','PUT',{state:{},etag})).status,400);
const unknown=f.client('unknown');assert.equal((await unknown.call('/api/state')).status,403);
const customer=f.addUser('customer','customer',['g1']);await customer.login();assert.equal((await customer.call('/api/state')).status,200);assert.equal((await customer.call('/api/state','PUT',{state,etag})).status,403);
assert.equal((await anon.call('/kontor')).status,302);assert.equal((await customer.call('/kontor')).status,302);
for(const path of ['/kontor','/app']){const page=await f.owner.call(path);assert.equal(page.status,200);new Function((await page.text()).match(/<script>([\s\S]*)<\/script>/)[1])}
const ui=await readFile('worker/ui.html','utf8');assert(!ui.includes('const initial=()=>({gardens:[{'));assert(!ui.includes('DEMODATA'));
console.log('PASS: protected routes; owner pin; no demonstration state; staff CAS; strict origin and CSRF; deny unknown users; customer bulk write denied; compiled UI syntax.');
