import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function testDatabase(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('drizzle/0000_portal_access.sql','utf8'));sqlite.exec(readFileSync('drizzle/0001_microsoft_customer_login.sql','utf8'));
 return {sqlite,prepare(sql){let values=[];return {bind(...v){values=v;return this},async first(){return sqlite.prepare(sql).get(...values)||null},async all(){return {results:sqlite.prepare(sql).all(...values)}},async run(){const s=sqlite.prepare(sql);const result=s.columns().length?(s.all(...values),sqlite.prepare('SELECT changes() AS changes').get()):s.run(...values);return {meta:{changes:Number(result.changes)}}}}},async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const statement of statements)out.push(await statement.run());sqlite.exec('COMMIT');return out}catch(error){sqlite.exec('ROLLBACK');throw error}}};
}
export const fixtureState=()=>({gardens:[],tasks:[],logs:[],messages:[],notifications:[],tools:[],quotes:[],prefs:{inapp:true,report:true,visit:true},timer:null,pricing:{hourlyRate:450,vat:25,history:[]},company:{name:'Testfirma',email:'staff@example.test'}});
export async function fixture(initial=null){
 const source=readFileSync('dist/server/index.js','utf8');const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
 const DB=testDatabase(),records=new Map();let revision=0;
 const BUCKET={async get(key){const raw=records.get(key);return raw?{json:async()=>JSON.parse(raw),etag:'r'+revision}:null},async put(key,value,opts={}){if(opts.onlyIf?.etagDoesNotMatch==='*'&&records.has(key))return null;records.set(key,value);return {etag:'r'+ ++revision}}};
 const env={DB,BUCKET,PORTAL_OWNER_EMAIL:'owner@example.test'};
 if(initial)DB.sqlite.prepare("INSERT INTO portal_state(id,data,version,updated_at) VALUES ('business',?,1,?)").run(JSON.stringify({...fixtureState(),...initial}),Date.now());
 const clients=new Map();
 function client(id='owner',email=id+'@example.test'){
  if(clients.has(id))return clients.get(id);let cookie='',csrf='';
  const c={id,email,async call(path,method='GET',body=null,extra={}){const headers={...(id?{'oai-authenticated-user-id':id,'oai-authenticated-user-email':email}:{}),origin:'https://example.test',cookie,'x-csrf-token':csrf,...(body!==null?{'Content-Type':'application/json'}:{}),...extra};const response=await worker.fetch(new Request('https://example.test'+path,{method,headers,...(body!==null?{body:JSON.stringify(body)}:{})}),env);const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];return response},async login(){const r=await c.call('/api/me');const d=await r.json();csrf=d.csrf||'';return {response:r,data:d}},get csrf(){return csrf},get cookie(){return cookie}};clients.set(id,c);return c;
 }
 const owner=client();await owner.login();
 return {worker,env,DB,BUCKET,records,client,owner,setState(state){DB.sqlite.prepare("INSERT INTO portal_state(id,data,version,updated_at) VALUES ('business',?,1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=version+1").run(JSON.stringify({...fixtureState(),...state}),Date.now())},state(){return JSON.parse(DB.sqlite.prepare("SELECT data FROM portal_state WHERE id='business'").get().data)},addUser(id,role,gardens=[],extra={}){DB.sqlite.prepare('INSERT INTO portal_users(id,email,name,role,can_operate,active,gardens,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?,?)').run(id,id+'@example.test',id,role,extra.canOperate?1:0,JSON.stringify(gardens),Date.now(),Date.now());return client(id)}};
}
