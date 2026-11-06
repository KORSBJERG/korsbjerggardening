import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const front=await readFile('worker/front.html','utf8');new Function(front.match(/<script>([\s\S]*)<\/script>/)[1]);
const ids=new Set([...front.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));for(const match of front.matchAll(/href="#([^"]+)"/g))assert.ok(ids.has(match[1]),'Missing anchor '+match[1]);
assert.match(front,/prefers-reduced-motion/);assert.match(front,/IntersectionObserver/);assert.match(front,/mailto:Gardening@Korsbjerg.dk/);assert.match(front,/href="\/app"/);assert.match(front,/href="\/kontor"/);
const code=await readFile('dist/server/index.js','utf8');const worker=(await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).default;
for(const path of ['/','/kontor','/app']){const r=await worker.fetch(new Request('https://example.test'+path),{});assert.equal(r.status,200);const body=await r.text();new Function(body.match(/<script>([\s\S]*)<\/script>/)[1]);assert.ok(path==='/'?body.includes('Mere liv i haven.'):body.includes('attendanceBanner()'));}
assert.equal((await worker.fetch(new Request('https://example.test/findes-ikke'),{})).status,404);
assert.equal((await worker.fetch(new Request('https://example.test/',{method:'HEAD'}),{})).status,200);
const office=await(await worker.fetch(new Request('https://example.test/kontor'),{})).text();assert.ok(office.includes("history.pushState({},'','/kontor')"));
console.log('PASS: front-end syntax; navigation anchors; video controls and motion preference; honest contact email flow; dedicated front, office and customer routes; app navigation preserved; HEAD and 404 handling.');
