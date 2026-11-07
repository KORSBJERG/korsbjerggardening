import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture} from './portal-test-support.mjs';
const source=readFileSync('dist/server/index.js','utf8');
const {deliverMail,transactionalMail,mailConfigured}=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {deliverMail,transactionalMail,mailConfigured};').toString('base64'));
const f=await fixture({gardens:[{id:'g1',name:'Have',customer:'Kunde',address:'Vej',area:100,budget:5}],quotes:[{id:'q1',garden:'g1',number:'KG-TEST',date:'2026-11-06',status:'Klar',vat:25,discount:0,items:[{id:'line1',description:'Havepleje',kind:'labor',mode:'hourly',quantity:2,unitPrice:450}]}]});
const env={...f.env,MAIL_PROVIDER:'smtp2go',SMTP2GO_API_KEY:'fake-key-only',MAIL_FROM:'Korsbjerg Gardening <Gardening@Korsbjerg.dk>'};
assert(mailConfigured(env));assert(!mailConfigured({...env,SMTP2GO_API_KEY:'',RESEND_API_KEY:'must-not-fallback'}));
let sends=0,payload,scenario='ok';const realFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 assert.equal(url,'https://eu-api.smtp2go.com/v3/email/send');assert.equal(options.headers['X-Smtp2go-Api-Key'],'fake-key-only');assert(!options.headers.Authorization);payload=JSON.parse(options.body);assert(!payload.api_key);assert.equal(payload.sender,env.MAIL_FROM);sends++;
 if(scenario==='timeout')throw Error('simulated network timeout');
 if(scenario==='rejected')return Response.json({data:{succeeded:0,failed:1,failures:['rejected']}});
 if(scenario==='invalid')return Response.json({data:{succeeded:1,failed:0}});
 return Response.json({data:{succeeded:1,failed:0,failures:[],email_id:'mock-smtp-id-'+sends}});
};
try{
 const message={to:'kunde@example.test',subject:'Invitation',text:'Dit personlige link',idempotencyKey:'invite-test'};
 assert.equal((await deliverMail(env,message)).status,'accepted');assert.deepEqual(payload.to,[message.to]);assert.equal(payload.text_body,message.text);
 const sent=await transactionalMail(env,message),count=sends;assert.equal(await transactionalMail(env,message),sent);assert.equal(sends,count);await assert.rejects(()=>transactionalMail(env,{...message,text:'different content'}));assert.equal(sends,count);
 scenario='timeout';await assert.rejects(()=>transactionalMail(env,{...message,idempotencyKey:'uncertain'}));const timeoutCount=sends;await assert.rejects(()=>transactionalMail(env,{...message,idempotencyKey:'uncertain'}));assert.equal(sends,timeoutCount);
 scenario='rejected';assert.equal((await deliverMail(env,message)).status,'failed');scenario='invalid';assert.equal((await deliverMail(env,message)).status,'unknown');
 scenario='ok';Object.assign(f.env,env);const body={to:'kunde@example.test',subject:'Dit tilbud',message:'Tilbud vedhæftet',requestId:crypto.randomUUID()};
 let response=await f.owner.call('/api/quotes/q1/email','POST',body);assert.equal(response.status,200);assert((await response.json()).accepted);assert.equal(payload.attachments[0].mimetype,'application/pdf');assert.equal(Buffer.from(payload.attachments[0].fileblob,'base64').subarray(0,5).toString(),'%PDF-');assert(!payload.attachments[0].content);
 const pdfSends=sends;response=await f.owner.call('/api/quotes/q1/email','POST',body);assert.equal(response.status,200);assert.equal(sends,pdfSends);
 response=await f.owner.call('/api/access/invitations','POST',{name:'Kunde',email:'invited@example.test',gardens:['g1'],role:'customer',delivery:'email'});assert.equal(response.status,201);assert((await response.json()).sent);assert.equal(payload.to[0],'invited@example.test');assert(payload.text_body.includes('#invite='));
 response=await f.owner.call('/api/mail/test','POST',{requestId:crypto.randomUUID(),to:'must-be-ignored@example.test'});assert.equal(response.status,200);assert.equal(payload.to[0],'anton@korsbjerg.dk');assert(!payload.text_body.includes('kunde@example.test'));
 const outsider=f.addUser('no-mail-access','customer',['g1']);await outsider.login();assert.equal((await outsider.call('/api/mail/test','POST',{requestId:crypto.randomUUID()})).status,403);
 const status=await(await f.owner.call('/api/mail/status')).json();assert.equal(status.provider,'smtp2go');assert(status.configured);
}finally{globalThis.fetch=realFetch}
console.log('PASS: SMTP2GO headers and payload; confirmed provider acceptance; PDF attachment encoding; invitation delivery; no silent provider fallback; same-message dedupe; mismatched reuse rejected; ambiguous/time-out results never retried. No real emails sent.');
