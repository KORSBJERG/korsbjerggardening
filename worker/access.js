// Sites dispatch is the only trusted identity provider. Never deploy this entry
// directly on an unprotected origin. cloudflare.js deliberately strips identity.
class PortalError extends Error { constructor(message,status=400){super(message);this.status=status} }
const fail=(message,status=400)=>{throw new PortalError(message,status)};
const query=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
const now=()=>Date.now();
const safeId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(v);
const fields=(o,keys)=>Object.fromEntries(keys.filter(k=>o[k]!==undefined).map(k=>[k,o[k]]));
const operates=u=>u.role==='anton'||u.role==='administrator'&&!!u.can_operate;
const emptyState=()=>({gardens:[],tasks:[],logs:[],messages:[],notifications:[],tools:[],quotes:[],prefs:{inapp:true,visit:true,report:true},timer:null,pricing:{hourlyRate:450,vat:25,history:[]}});
const userView=u=>({id:u.id,email:u.email,name:u.name,role:u.role,canOperate:operates(u),active:!!u.active,gardens:JSON.parse(u.gardens)});
async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('')}
const secretToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32))).map(v=>v.toString(16).padStart(2,'0')).join('');
function auditStatement(env,u,action,target){return query(env,'INSERT INTO portal_audit (id,user_id,action,target,created_at) VALUES (?,?,?,?,?)',crypto.randomUUID(),u.id,action,String(target).slice(0,300),now())}
async function audit(env,u,action,target){await auditStatement(env,u,action,target).run()}
async function limit(env,u,action,max=60){
 const window=Math.floor(now()/60000),key=u.id+':'+action+':'+window;
 const row=await query(env,'INSERT INTO portal_limits (id,count,expires_at) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count',key,now()+120000).first();
 if(row.count>max)fail('For mange forsøg. Vent et minut.',429);
 await query(env,'DELETE FROM portal_limits WHERE expires_at < ?',now()).run();
}
async function readBody(request,max=500000){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))fail('Brug JSON.',415);
 if(Number(request.headers.get('content-length')||0)>max)fail('For mange data.',413);
 const reader=request.body?.getReader();if(!reader)fail('Data mangler.');
 let size=0;const chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();fail('For mange data.',413)}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 try{return JSON.parse(new TextDecoder().decode(bytes))}catch{fail('Ugyldige JSON-data.')}
}
async function principal(request,env,{allowUnregistered=false}={}){
 if(externalLogin(env))return externalPrincipal(request,env);
 const id=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
 if(!id||!email)fail('Log ind for at fortsætte.',401);
 if(!env.DB)fail('Adgangsdatabasen er ikke tilsluttet.',503);
 let u=await query(env,'SELECT * FROM portal_users WHERE id=?',id).first();
 // No first-visitor takeover: bootstrap requires a configured verified owner email,
 // and the first matching immutable Sites ID is pinned atomically in D1.
 if(!u&&env.PORTAL_OWNER_EMAIL&&email===env.PORTAL_OWNER_EMAIL.trim().toLowerCase()){
  await query(env,"INSERT OR IGNORE INTO portal_state (id,data,version,updated_at) VALUES ('owner',?,1,?)",JSON.stringify({id}),now()).run();
  const owner=await query(env,"SELECT data FROM portal_state WHERE id='owner'").first();
  if(JSON.parse(owner.data).id===id){
   await query(env,'INSERT OR IGNORE INTO portal_users (id,email,name,role,can_operate,active,gardens,created_at,updated_at) VALUES (?,?,?,\'administrator\',1,1,\'[]\',?,?)',id,email,'Peter Korsbjerg',now(),now()).run();
   u=await query(env,'SELECT * FROM portal_users WHERE id=?',id).first();
  }
 }
 if(u&&!u.active)fail('Din adgang er spærret.',403);
 if(!u){if(allowUnregistered)return {id,email,unregistered:true};fail('Du har endnu ikke fået adgang. Bed Anton om en invitation.',403)}
 return u;
}
async function session(request,env,u,create=false){
 const cookie=request.headers.get('cookie')?.match(/(?:^|;\s*)__Host-gardening=([a-f0-9]{64})(?:;|$)/)?.[1];
 let row=cookie?await query(env,'SELECT * FROM portal_sessions WHERE token_hash=? AND user_id=?',await digest(cookie),u.id).first():null;
 const idle=operates(u)||u.role==='administrator'?1800000:86400000;
 if(row&&(row.expires_at<=now()||row.last_seen+idle<=now())){await query(env,'DELETE FROM portal_sessions WHERE token_hash=?',row.token_hash).run();row=null}
 if(!row){
  if(!create)fail('Sessionen er udløbet. Genindlæs siden.',401);
  const token=secretToken(),csrf=secretToken(),ttl=u.unregistered?3600000:u.role==='customer'?604800000:28800000;
  row={token_hash:await digest(token),user_id:u.id,csrf,created_at:now(),last_seen:now(),expires_at:now()+ttl};
  // Invitation acceptance may establish a session before a user row exists.
  if(!u.unregistered)await query(env,'INSERT INTO portal_sessions (token_hash,user_id,csrf,created_at,last_seen,expires_at) VALUES (?,?,?,?,?,?)',row.token_hash,u.id,csrf,row.created_at,row.last_seen,row.expires_at).run();
  row.setCookie='__Host-gardening='+token+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+Math.floor(ttl/1000);
 }else await query(env,'UPDATE portal_sessions SET last_seen=? WHERE token_hash=?',now(),row.token_hash).run();
 return row;
}
function checkOrigin(request){if(request.headers.get('origin')!==new URL(request.url).origin)fail('Ugyldig oprindelse.',403)}
async function writeGuard(request,env,u){checkOrigin(request);const s=await session(request,env,u);if(request.headers.get('x-csrf-token')!==s.csrf)fail('Sikkerhedskontrollen fejlede. Genindlæs siden.',403);await limit(env,u,'write',120);return s}
async function sharedState(env,u){
 let row=await query(env,"SELECT * FROM portal_state WHERE id='business'").first();
 if(!row){
  if(u.role!=='administrator')fail('Kontoret skal klargøres af administratoren.',503);
  if(!env.BUCKET)fail('Det eksisterende datalager mangler. Ingen data er flyttet.',503);
  const legacyKey='gardening/'+encodeURIComponent(u.id)+'.json',legacy=await env.BUCKET.get(legacyKey);
  const data=legacy?await legacy.json():emptyState();
  // Keep the original untouched and make an additional immutable copy before import.
  if(legacy)await env.BUCKET.put('gardening-backups/access-v1/'+encodeURIComponent(u.id)+'.json',JSON.stringify(data),{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
  const normalized={...emptyState(),...data};
  await env.DB.batch([query(env,"INSERT OR IGNORE INTO portal_state (id,data,version,migrated_from,updated_at) VALUES ('business',?,1,?,?)",JSON.stringify(normalized),legacy?legacyKey:null,now()),auditStatement(env,u,'state.initialize',legacy?legacyKey:'empty')]);
  row=await query(env,"SELECT * FROM portal_state WHERE id='business'").first();
 }
 return {state:JSON.parse(row.data),version:row.version};
}
function customerState(state,u){
 const allowed=new Set(JSON.parse(u.gardens)),out=emptyState();
 out.gardens=state.gardens.filter(g=>allowed.has(g.id)).map(g=>({...fields(g,['id','name','customer','address','area','budget','photo']),...(g.mapPosition?{mapPosition:fields(g.mapPosition,['lat','lng','address'])}:{})}));
 const own=new Set(out.gardens.map(g=>g.id));
 out.tasks=state.tasks.filter(t=>own.has(t.garden)&&t.customerVisible!==false).map(t=>({...fields(t,['id','garden','title','date','time','hours','status','note']),...(t.billing?{billing:fields(t.billing,['mode','price','quantity','discount'])}:{})}));
 out.logs=state.logs.filter(l=>own.has(l.garden)&&l.customerVisible===true).map(l=>fields(l,['id','garden','task','date','hours','durationSeconds','checkedInAt','checkedOutAt','note']));
 out.messages=state.messages.filter(m=>own.has(m.garden)&&m.internal!==true).map(m=>fields(m,['id','garden','from','senderId','text','date']));
 out.quotes=(state.quotes||[]).filter(q=>own.has(q.garden)&&q.status!=='Kladde').map(q=>({...fields(q,['id','garden','number','title','date','validUntil','status','vat','discount','note','customerName','gardenName','address','updatedAt','respondedAt']),company:fields(q.company||state.company||{},['name','email','phone','address','cvr']),items:q.items.map(l=>fields(l,['id','description','kind','mode','quantity','unitPrice']))}));
 out.company=fields(state.company||{},['name','email','phone','address','cvr']);
 delete out.pricing;return out;
}
async function persistState(env,u,state,version,action,target){
 const raw=JSON.stringify(state);if(new TextEncoder().encode(raw).byteLength>500000)fail('Kontorets data overstiger den aktuelle størrelsesgrænse.',413);
 const eventId=crypto.randomUUID();
 const results=await env.DB.batch([
  query(env,"UPDATE portal_state SET data=?,version=version+1,updated_at=? WHERE id='business' AND version=?",raw,now(),version),
  query(env,"INSERT INTO portal_audit (id,user_id,action,target,created_at) SELECT ?,?,?,?,? WHERE changes()=1",eventId,u.id,action,target,now())
 ]);
 if(results[0].meta.changes!==1)fail('Oplysningerne er ændret. Genindlæs siden og prøv igen.',409);
 return version+1;
}
function validateState(s,old,u){
 if(!s||typeof s!=='object')fail('Data mangler.');
 for(const collection of ['gardens','tasks','logs','messages','quotes','tools','notifications']){
  if(!Array.isArray(s[collection])||s[collection].length>3000)fail('Ugyldig samling: '+collection);
  const ids=new Set();for(const item of s[collection]){if(!item||!safeId(item.id)||ids.has(item.id))fail('Ugyldigt eller gentaget id.');ids.add(item.id)}
 }
 function walk(value,depth=0){if(depth>12)fail('Data er for komplekse.');if(typeof value==='string'&&value.length>10000)fail('Et tekstfelt er for langt.');if(typeof value==='number'&&!Number.isFinite(value))fail('Ugyldigt tal.');if(value&&typeof value==='object')for(const [k,v]of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(k))fail('Ugyldigt felt.');walk(v,depth+1)}}walk(s);
 const gardens=new Set(s.gardens.map(g=>g.id));
 for(const key of ['tasks','logs','messages','quotes'])for(const row of s[key])if(!gardens.has(row.garden))fail('En post mangler en gyldig have.');
 for(const g of s.gardens)if(typeof g.name!=='string'||typeof g.address!=='string'||typeof g.customer!=='string'||!Number.isFinite(g.area)||!Number.isFinite(g.budget))fail('Kontroller havens oplysninger.');
 for(const t of s.tasks){if(!['Planlagt','I gang','Afventer godkendelse','Afsluttet','Afvist'].includes(t.status)||!/^\d{2}:\d{2}$/.test(t.time)||!/^\d{4}-\d{2}-\d{2}$/.test(t.date)||!Number.isFinite(t.hours)||t.hours<0)fail('Kontroller opgavens status, dato, tid og timer.');if(t.billing&&(!['hourly','fixed'].includes(t.billing.mode)||!Number.isFinite(t.billing.price)||t.billing.price<0))fail('Ugyldig opgavepris.')}
 for(const l of s.logs)if(!Number.isFinite(l.hours)||l.hours<0||!/^\d{4}-\d{2}-\d{2}$/.test(l.date))fail('Ugyldig tidsregistrering.');
 for(const q of s.quotes){if(!['Kladde','Klar','Godkendt','Afvist'].includes(q.status)||!Array.isArray(q.items)||!q.items.length||q.items.length>200||!q.items.every(l=>safeId(l.id)&&typeof l.description==='string'&&['hourly','fixed'].includes(l.mode)&&Number.isFinite(l.quantity)&&l.quantity>0&&Number.isFinite(l.unitPrice)&&l.unitPrice>=0)||!Number.isFinite(q.vat)||q.vat<0||q.vat>100||!Number.isFinite(q.discount)||q.discount<0||q.discount>100||!/^\d{4}-\d{2}-\d{2}$/.test(q.date))fail('Kontroller tilbuddet.');}
 for(const q of old.quotes||[]){if(q.status==='Kladde')continue;const next=s.quotes.find(x=>x.id===q.id);if(!next)fail('Et publiceret tilbud kan ikke slettes.',409);const immutable=['garden','items','vat','discount','date','validUntil','customerName','customerEmail','gardenName','address','company','note','title','number','respondedAt','respondedBy'];if(JSON.stringify(fields(q,immutable))!==JSON.stringify(fields(next,immutable)))fail('Et publiceret tilbud er låst. Opret en kopi.',409);if(next.status!==q.status)fail('Kundens tilbudssvar skal registreres via tilbudshandlingen.',409)}
 for(const q of s.quotes){const before=(old.quotes||[]).find(x=>x.id===q.id);if(!before&&['Godkendt','Afvist'].includes(q.status))fail('Nye tilbud skal begynde som kladde eller klar.');if(q.status==='Klar'&&(!before||before.status==='Kladde')){q.updatedAt=new Date().toISOString();q.company={...(s.company||{})};delete q.respondedAt;delete q.respondedBy}}
 for(const task of old.tasks||[]){const next=s.tasks.find(x=>x.id===task.id);if(task.respondedBy&&(!next||next.respondedBy!==task.respondedBy||next.respondedAt!==task.respondedAt))fail('Kundens svarhistorik kan ikke ændres.',409)}
 // Existing customer messages and response evidence cannot be rewritten in a bulk save.
 for(const m of old.messages||[]){const next=s.messages.find(x=>x.id===m.id);if(!next||JSON.stringify(next)!==JSON.stringify(m))fail('Gemte beskeder kan ikke ændres eller slettes.',409)}
 for(const m of s.messages)if(!(old.messages||[]).some(x=>x.id===m.id))Object.assign(m,{from:u.name,senderId:u.id,date:new Date().toISOString()});
 return fields(s,['gardens','tasks','logs','messages','quotes','tools','notifications','prefs','timer','pricing','company']);
}
async function invitationAccept(request,env){
 checkOrigin(request);const u=await principal(request,env,{allowUnregistered:true});await limit(env,u,'accept-invite',10);const body=await readBody(request,3000);
 if(typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))fail('Invitationen er ugyldig.',403);
 const invite=await query(env,'SELECT * FROM portal_invitations WHERE token_hash=?',await digest(body.token)).first();
 if(!invite||invite.revoked||invite.consumed_by||invite.expires_at<now()||invite.email!==u.email)fail('Invitationen er udløbet, brugt eller udstedt til en anden e-mail.',403);
 if(!u.unregistered)fail('Denne konto har allerede adgang. Administratoren skal ændre rettighederne.',409);
 // Consumption and membership creation run in one D1 transaction. A conflicting
 // second redemption fails the ID uniqueness check and rolls back completely.
 const t=now();await env.DB.batch([
  query(env,'INSERT INTO portal_users (id,email,name,role,can_operate,active,gardens,created_at,updated_at) SELECT ?,email,name,role,can_operate,1,gardens,?,? FROM portal_invitations WHERE id=? AND consumed_by IS NULL AND revoked=0 AND expires_at>?',u.id,t,t,invite.id,t),
  query(env,'UPDATE portal_invitations SET consumed_by=? WHERE id=? AND consumed_by IS NULL AND EXISTS (SELECT 1 FROM portal_users WHERE id=?)',u.id,invite.id,u.id),
  auditStatement(env,u,'invitation.accept',invite.id)
 ]);
 if(!(await query(env,'SELECT id FROM portal_users WHERE id=?',u.id).first()))fail('Invitationen er ikke længere tilgængelig.',409);
 return json({accepted:true});
}
async function handlePortalRoutes(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(!path.startsWith('/api/'))return null;
 if(path==='/api/invitations/accept'&&request.method==='POST'){if(externalLogin(env))fail('Brug invitationslinket fra din mail.',403);return invitationAccept(request,env);}
 const u=await principal(request,env,{allowUnregistered:path==='/api/me'});
 if(path==='/api/me'&&request.method==='GET'){
  if(u.unregistered)return json({user:null,pending:true,email:u.email});
  const s=await session(request,env,u,true);await query(env,'DELETE FROM portal_sessions WHERE expires_at < ?',now()).run();
  return json({user:{...userView(u),provider:externalLogin(env)?'microsoft':'sites'},csrf:s.csrf,expiresAt:s.expires_at},200,s.setCookie?{'Set-Cookie':s.setCookie}:{});
 }
 if(!['GET','HEAD'].includes(request.method))await writeGuard(request,env,u);else await session(request,env,u);
 if(path==='/api/session/logout'&&request.method==='POST'){if(externalLogin(env))await query(env,'DELETE FROM portal_login_sessions WHERE user_id=?',u.id).run();await query(env,'DELETE FROM portal_sessions WHERE user_id=?',u.id).run();return json({ok:true},200,{'Set-Cookie':'__Host-gardening=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'})}
 if(path.startsWith('/api/access'))return accessRoutes(request,env,u);
 if(path==='/api/state'){
  const {state,version}=await sharedState(env,u);
  if(request.method==='GET')return json({state:operates(u)?state:u.role==='customer'?customerState(state,u):emptyState(),etag:String(version)});
  if(request.method!=='PUT')return json({error:'Metoden er ikke understøttet.'},405);
  if(!operates(u))fail('Kun havekontoret kan ændre kontorets data.',403);
  const body=await readBody(request);if(String(body.etag)!==String(version))fail('Oplysningerne er ændret. Genindlæs siden.',409);
  const next=validateState(body.state,state,u);return json({etag:String(await persistState(env,u,next,version,'state.update','business')),state:next});
 }
 if(path==='/api/messages'&&request.method==='POST'){
  const body=await readBody(request,8000),{state,version}=await sharedState(env,u);requireGarden(state,u,body.garden);
  if(typeof body.text!=='string'||!body.text.trim()||body.text.length>2000)fail('Beskeden skal være mellem 1 og 2000 tegn.');
  const id=crypto.randomUUID();state.messages.push({id,garden:body.garden,text:body.text.trim(),from:u.name,senderId:u.id,date:new Date().toISOString()});
  await persistState(env,u,state,version,'message.create',id);return json({ok:true},201);
 }
 if(path==='/api/requests'&&request.method==='POST'){
  const body=await readBody(request,6000),{state,version}=await sharedState(env,u);requireGarden(state,u,body.garden);
  if(u.role!=='customer')fail('Brug kontorets opgavefunktion.',403);
  if(typeof body.title!=='string'||!body.title.trim()||body.title.length>150||typeof body.note!=='string'||body.note.length>2000)fail('Kontroller opgaveønsket.');
  const id=crypto.randomUUID();state.tasks.push({id,garden:body.garden,title:body.title.trim(),note:body.note,date:new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Copenhagen'}),time:'09:00',hours:0,status:'Afventer godkendelse',requestedBy:u.id,customerVisible:true});
  await persistState(env,u,state,version,'task.request',id);return json({ok:true},201);
 }
 if(path==='/api/attendance/checkin'&&request.method==='POST'){
  if(!operates(u))fail('Kun havekontoret kan registrere arbejdstid.',403);
  const body=await readBody(request,3000),{state,version}=await sharedState(env,u),task=state.tasks.find(t=>t.id===body.taskId);
  if(!task)fail('Opgaven blev ikke fundet.',404);
  if(state.timer||['Afsluttet','Afventer godkendelse','Afvist'].includes(task.status))fail('Opgaven kan ikke startes, eller en timer er allerede aktiv.',409);
  task.status='I gang';state.timer={sessionId:crypto.randomUUID(),taskId:task.id,garden:task.garden,task:task.title,start:now(),userId:u.id};
  await persistState(env,u,state,version,'attendance.checkin',task.id);return json({ok:true});
 }
 if(path==='/api/attendance/checkout'&&request.method==='POST'){
  if(!operates(u))fail('Kun havekontoret kan registrere arbejdstid.',403);
  const body=await readBody(request,6000),{state,version}=await sharedState(env,u),timer=state.timer;
  if(!timer||timer.sessionId!==body.sessionId)fail('Indtjekningen er ændret eller allerede afsluttet.',409);
  if(typeof body.note!=='string'||body.note.length>2000)fail('Noten er for lang.');
  const end=now(),seconds=Math.max(1,Math.round((end-timer.start)/1000));
  if(end<timer.start)fail('Ugyldigt starttidspunkt.',409);
  state.logs.push({id:crypto.randomUUID(),sessionId:timer.sessionId,taskId:timer.taskId,garden:timer.garden,task:timer.task,date:new Date(timer.start).toLocaleDateString('sv-SE',{timeZone:'Europe/Copenhagen'}),hours:seconds/3600,durationSeconds:seconds,checkedInAt:new Date(timer.start).toISOString(),checkedOutAt:new Date(end).toISOString(),note:body.note.trim(),customerVisible:!!body.customerVisible,recordedBy:u.id});
  const task=state.tasks.find(t=>t.id===timer.taskId);if(task)task.status=body.complete?'Afsluttet':'Planlagt';state.timer=null;
  await persistState(env,u,state,version,'attendance.checkout',timer.taskId);return json({ok:true});
 }
 const response=path.match(/^\/api\/(quotes|tasks)\/([A-Za-z0-9_-]{1,120})\/(accept|decline)$/);
 if(response&&request.method==='POST'){
  const body=await readBody(request,3000),{state,version}=await sharedState(env,u),[,kind,id,action]=response;
  const obj=state[kind].find(x=>x.id===id);if(!obj)fail('Posten blev ikke fundet.',404);requireGarden(state,u,obj.garden);
  if(u.role!=='customer')fail('Kun den tilknyttede kunde kan godkende. Send kunden en invitation.',403);
  if(kind==='quotes'&&(obj.status!=='Klar'||body.version!==obj.updatedAt))fail('Tilbuddet er ændret eller allerede besvaret.',409);
  if(kind==='quotes'&&obj.validUntil&&obj.validUntil<new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Copenhagen'}))fail('Tilbuddet er udløbet.',409);
  if(kind==='tasks'&&(obj.status!=='Afventer godkendelse'||obj.customerVisible===false||obj.requestedBy))fail('Opgaven kan ikke godkendes.',409);
  obj.status=action==='accept'?(kind==='quotes'?'Godkendt':'Planlagt'):'Afvist';obj.respondedAt=new Date().toISOString();obj.respondedBy=u.id;
  await persistState(env,u,state,version,kind+'.'+action,id);return json({ok:true});
 }
 if(path.startsWith('/api/quotes/')||['/api/mail/status','/api/mail/test'].includes(path))return handleQuoteRoutes(request,env,u);
 return json({error:'Siden blev ikke fundet.'},404);
}
function requireGarden(state,u,id){if(!state.gardens.some(g=>g.id===id)||!operates(u)&&!(u.role==='customer'&&JSON.parse(u.gardens).includes(id)))fail('Posten blev ikke fundet.',404)}
async function accessRoutes(request,env,u){
 const path=new URL(request.url).pathname,isAdmin=u.role==='administrator';
 if(!isAdmin&&!operates(u))fail('Du har ikke adgang til brugeradministration.',403);
 if(path==='/api/access/export'&&request.method==='GET'){if(!isAdmin)fail('Kun administratoren kan hente en sikkerhedskopi.',403);const snapshot=await sharedState(env,u);await audit(env,u,'state.export','business');const response=json({format:'korsbjerg-portal-state-v1',exportedAt:new Date().toISOString(),...snapshot});response.headers.set('Content-Disposition','attachment; filename="korsbjerg-havekontor-backup.json"');return response;}
 if(path==='/api/access'&&request.method==='GET'){
  const users=(await query(env,'SELECT * FROM portal_users ORDER BY created_at').all()).results;
  const invites=(await query(env,'SELECT id,email,name,role,gardens,expires_at,consumed_by,revoked FROM portal_invitations ORDER BY created_at DESC LIMIT 100').all()).results;
  const events=isAdmin?(await query(env,'SELECT user_id,action,target,created_at FROM portal_audit ORDER BY created_at DESC LIMIT 100').all()).results:[];
  return json({authMode:externalLogin(env)?'microsoft':'sites',mailConfigured:mailConfigured(env),users:users.filter(x=>isAdmin||x.role==='customer').map(userView),invitations:invites.filter(x=>isAdmin||x.role==='customer').map(x=>({...x,gardens:JSON.parse(x.gardens)})),events});
 }
 if(path==='/api/access/invitations'&&request.method==='POST'){
  await limit(env,u,'invite',10);const body=await readBody(request,6000),role=body.role||'customer';
  if(externalLogin(env)&&role!=='customer')fail('Medarbejderadgang styres med Microsoft 365.',403);
  if(body.delivery==='email'&&!mailConfigured(env))fail('Mailafsendelse er ikke tilsluttet. Vælg mailkladde.',503);
  if(!['administrator','anton','customer'].includes(role)||!isAdmin&&role!=='customer')fail('Du kan kun invitere kunder.',403);
  if(typeof body.email!=='string'||!emailPattern.test(body.email)||body.email.length>254||typeof body.name!=='string'||!body.name.trim()||body.name.length>100)fail('Kontroller navn og e-mail.');
  const {state}=await sharedState(env,u),gardens=body.gardens;
  if(!Array.isArray(gardens)||!gardens.every(id=>safeId(id)&&state.gardens.some(g=>g.id===id))||role==='customer'&&!gardens.length)fail('Vælg mindst én eksisterende have til kunden.');
  const email=body.email.trim().toLowerCase();if(await query(env,'SELECT id FROM portal_users WHERE email=?',email).first())fail('Denne bruger findes allerede. Rediger adgang i oversigten.',409);
  const token=secretToken(),id=crypto.randomUUID(),expires=now()+172800000;
  await env.DB.batch([query(env,'INSERT INTO portal_invitations (id,token_hash,email,name,role,can_operate,gardens,expires_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',id,await digest(token),email,body.name.trim(),role,isAdmin&&role==='administrator'&&body.canOperate?1:0,JSON.stringify([...new Set(gardens)]),expires,u.id,now()),auditStatement(env,u,'invitation.create',id)]);
  const origin=externalLogin(env)?portalOrigin(request,env):new URL(request.url).origin,url=origin+(externalLogin(env)?'/login':'/app')+'#invite='+token;
  let sent=false,mailError='';if(body.delivery==='email'){try{await authEmail(env,email,'Du er inviteret til Korsbjerg Gardening','Hej '+body.name.trim()+'\n\nAnton har inviteret dig til din personlige haveportal. Opret din konto via dette link:\n'+url+'\n\nInvitationen gælder kun din mailadresse, kan bruges én gang og udløber efter 48 timer. Videresend den ikke.\n\nVenlig hilsen\nAnton · Korsbjerg Gardening',id);sent=true;await audit(env,u,'invitation.email',id)}catch(error){mailError=error.message}}
  return json({id,url,expiresAt:expires,sent,mailError},201);
 }
 const revoke=path.match(/^\/api\/access\/invitations\/([A-Za-z0-9_-]+)\/revoke$/);
 if(revoke&&request.method==='POST'){
  const invite=await query(env,'SELECT * FROM portal_invitations WHERE id=?',revoke[1]).first();if(!invite||!isAdmin&&invite.role!=='customer')fail('Invitationen blev ikke fundet.',404);
  await env.DB.batch([query(env,'UPDATE portal_invitations SET revoked=1 WHERE id=?',invite.id),auditStatement(env,u,'invitation.revoke',invite.id)]);return json({ok:true});
 }
 if(path==='/api/access/user'&&request.method==='POST'){
  const body=await readBody(request,6000),target=await query(env,'SELECT * FROM portal_users WHERE id=?',body.id||'').first();
  if(!target||!isAdmin&&target.role!=='customer')fail('Brugeren blev ikke fundet.',404);
  if(target.id===u.id)fail('Du kan ikke ændre din egen adgang. Brug en anden administrator.',409);
  const role=isAdmin?(body.role||target.role):'customer';if(!['administrator','anton','customer'].includes(role))fail('Ugyldig rolle.');
  if(externalLogin(env)&&(target.role!=='customer'||role!=='customer'))fail('Microsoft-administratoren kan ikke ændres her.',403);
  const owner=await query(env,"SELECT data FROM portal_state WHERE id='owner'").first();if(owner&&JSON.parse(owner.data).id===target.id)fail('Den primære ejer kan ikke spærres eller ændres her.',409);
  const {state}=await sharedState(env,u),gardens=body.gardens;if(!Array.isArray(gardens)||!gardens.every(id=>safeId(id)&&state.gardens.some(g=>g.id===id))||role==='customer'&&body.active&&!gardens.length)fail('Kontroller havetilknytningen.');
  if(externalLogin(env))await query(env,'DELETE FROM portal_login_sessions WHERE user_id=?',target.id).run();
  await env.DB.batch([query(env,'UPDATE portal_users SET role=?,can_operate=?,active=?,gardens=?,updated_at=? WHERE id=?',role,isAdmin&&role==='administrator'&&body.canOperate?1:0,body.active?1:0,JSON.stringify([...new Set(gardens)]),now(),target.id),query(env,'DELETE FROM portal_sessions WHERE user_id=?',target.id),auditStatement(env,u,'user.access',target.id)]);return json({ok:true});
 }
 return json({error:'Siden blev ikke fundet.'},404);
}
