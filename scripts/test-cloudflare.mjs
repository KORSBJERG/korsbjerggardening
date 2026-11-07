import assert from 'node:assert/strict';import {readFile,access} from 'node:fs/promises';
import cloudflare from '../worker/cloudflare.js';
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
assert.equal(config.keep_vars,true);assert.equal(config.d1_databases[0].binding,'DB');assert.equal(config.r2_buckets[0].jurisdiction,'eu');assert(!config.vars.PORTAL_AUTH_MODE,'Microsoft login is activated separately after migration');
assert.equal(config.main,'worker/cloudflare.js');assert.equal(config.build.command,'node scripts/build-custom.mjs');await access(config.main);await access('dist/server/index.js');
const origin='https://gardening.example';
for(const path of ['/','/haekklipning','/sitemap.xml','/robots.txt','/brand-logo.png']){
 const res=await cloudflare.fetch(new Request(origin+path),{});assert.equal(res.status,200,path);
}
for(const path of ['/app','/kontor','/app/tilbud?reference=123']){
 const res=await cloudflare.fetch(new Request(origin+path),{});assert.equal(res.status,302);assert.equal(res.headers.get('location'),config.vars.PORTAL_ORIGIN+path);assert.match(res.headers.get('x-robots-tag'),/noindex/);
}
let bucketUsed=false;const env={get BUCKET(){bucketUsed=true;throw Error('Public deployment must not use app data')}};
for(const path of ['/api/state','/api/mail/status','/api/quotes/test/pdf']){
 const res=await cloudflare.fetch(new Request(origin+path,{headers:{'oai-authenticated-user-id':'forged','oai-authenticated-user-email':'forged@example.com'}}),env);assert.equal(res.status,404);
}
assert.equal(bucketUsed,false);
assert.equal((await cloudflare.fetch(new Request(origin+'/app',{method:'POST'}),{})).status,405);
assert.equal((await cloudflare.fetch(new Request(origin+'/app'),{PORTAL_ORIGIN:origin})).status,503);
assert.equal((await cloudflare.fetch(new Request(origin+'/kontor'),{PORTAL_ORIGIN:'http://unsafe.example'})).status,503);
const home=await(await cloudflare.fetch(new Request(origin+'/'),{})).text();assert.ok(home.includes('href="'+origin+'/"'));
console.log('PASS: explicit Wrangler entry/build; public website and SEO routes; protected portal redirects; standalone API isolation; forged identity blocked; invalid/looping portal configuration rejected.');
