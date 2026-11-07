// Enabled only on an explicitly configured standalone portal. Sites retains its
// own identity integration while the existing private deployment is in use.
const externalLogin=env=>env.PORTAL_AUTH_MODE==='microsoft';
const guid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
function entraReady(env){return !!(guid(env.MS_TENANT_ID)&&guid(env.MS_CLIENT_ID)&&guid(env.MS_ADMIN_OBJECT_ID)&&env.MS_CLIENT_SECRET)}
function portalOrigin(request,env){
 let configured;try{configured=new URL(env.PORTAL_PUBLIC_ORIGIN)}catch{fail('Portalens adresse er ikke tilsluttet.',503)}
 if(configured.protocol!=='https:'||configured.username||configured.password||configured.pathname!=='/'||configured.search||configured.hash||configured.origin!==new URL(request.url).origin)fail('Portalens adresse er ikke korrekt tilsluttet.',503);
 return configured.origin;
}
const loginCookie=(token,ttl=28800)=>'__Host-gardening-login='+token+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+ttl;
const oauthCookie=(token,ttl=600)=>'__Host-gardening-oauth='+token+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+ttl;
function authCookie(request,name){return request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||''}
async function externalPrincipal(request,env){
 if(!env.DB)fail('Login-databasen er ikke tilsluttet.',503);
 const token=authCookie(request,'__Host-gardening-login');if(!/^[a-f0-9]{64}$/.test(token))fail('Log ind for at fortsætte.',401);
 const row=await query(env,'SELECT * FROM portal_login_sessions WHERE token_hash=?',await digest(token)).first();
 if(!row||row.expires_at<=now())fail('Dit login er udløbet. Log ind igen.',401);
 const u=await query(env,'SELECT * FROM portal_users WHERE id=?',row.user_id).first();
 if(!u||!u.active)fail('Din adgang er spærret.',403);
 if(row.last_seen+(u.role==='customer'?86400000:1800000)<=now())fail('Dit login er udløbet. Log ind igen.',401);
 if(u.role!=='customer'&&u.id!=='microsoft_'+env.MS_TENANT_ID?.toLowerCase()+'_'+env.MS_ADMIN_OBJECT_ID?.toLowerCase())fail('Administratorens Microsoft-adgang er ændret.',403);
 await query(env,'UPDATE portal_login_sessions SET last_seen=? WHERE token_hash=?',now(),row.token_hash).run();
 return u;
}
async function establishLogin(env,u){
 const token=secretToken(),ttl=u.role==='customer'?604800:28800;
 await query(env,'INSERT INTO portal_login_sessions(token_hash,user_id,created_at,last_seen,expires_at) VALUES (?,?,?,?,?)',await digest(token),u.id,now(),now(),now()+ttl*1000).run();
 await query(env,'DELETE FROM portal_login_sessions WHERE expires_at < ?',now()).run();
 return loginCookie(token,ttl);
}
async function claimAuthToken(env,token,kind){
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))fail('Linket er ugyldigt eller udløbet.',403);
 const hash=await digest(token),row=await query(env,'SELECT * FROM portal_auth_tokens WHERE token_hash=? AND kind=?',hash,kind).first();
 if(!row||row.used_at||row.expires_at<=now())fail('Linket er ugyldigt, brugt eller udløbet.',403);
 const update=await query(env,'UPDATE portal_auth_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?',now(),hash,now()).run();
 if(update.meta.changes!==1)fail('Linket er allerede brugt.',409);
 return row;
}
const microsoftKeys=new Map();
async function verifyMicrosoftToken(token,env,nonce,keySet){
 const tenant=env.MS_TENANT_ID.toLowerCase();
 if(!microsoftKeys.has(tenant))microsoftKeys.set(tenant,PortalJOSE.createRemoteJWKSet(new URL('https://login.microsoftonline.com/'+tenant+'/discovery/v2.0/keys')));
 const {payload}=await PortalJOSE.jwtVerify(token,keySet||microsoftKeys.get(tenant),{issuer:'https://login.microsoftonline.com/'+tenant+'/v2.0',audience:env.MS_CLIENT_ID,algorithms:['RS256'],requiredClaims:['exp','iat','sub','nonce','tid','oid'],clockTolerance:30,maxTokenAge:'10m'});
 if(payload.nonce!==nonce||payload.tid?.toLowerCase()!==tenant||payload.oid?.toLowerCase()!==env.MS_ADMIN_OBJECT_ID.toLowerCase())fail('Denne Microsoft-konto har ikke administratoradgang.',403);
 return payload;
}
async function authEmail(env,to,subject,text,id){
 if(!env.RESEND_API_KEY||!env.MAIL_FROM)fail('Mailafsendelse er ikke tilsluttet endnu. Brug en mailkladde til invitationer.',503);
 let r;try{r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'portal/'+id},body:JSON.stringify({from:env.MAIL_FROM,to:[to],subject,text}),signal:AbortSignal.timeout(15000)});const data=await r.json();if(!r.ok||!data.id)throw Error();return data.id}catch{fail('Mailtjenesten kunne ikke bekræfte afsendelsen. Kontroller afsendelsesoversigten før du prøver igen.',502)}
}
async function acceptCustomerInvitation(request,env,body){
 const hash=typeof body.token==='string'&&/^[a-f0-9]{64}$/.test(body.token)?await digest(body.token):'';
 const invite=await query(env,'SELECT * FROM portal_invitations WHERE token_hash=?',hash).first();
 if(!invite||invite.role!=='customer'||invite.revoked||invite.consumed_by||invite.expires_at<=now())fail('Invitationen er ugyldig, brugt eller udløbet. Bed Anton om en ny invitation.',403);
 // The invitation email is authoritative; no email or garden IDs from the form.
 const id='customer_'+await digest(invite.email),t=now();
 if(await query(env,'SELECT id FROM portal_users WHERE email=?',invite.email).first())fail('Der findes allerede en konto. Brug kundelogin.',409);
 await env.DB.batch([
  query(env,"INSERT INTO portal_users(id,email,name,role,can_operate,active,gardens,created_at,updated_at) SELECT ?,email,name,'customer',0,1,gardens,?,? FROM portal_invitations WHERE id=? AND consumed_by IS NULL AND revoked=0 AND expires_at>?",id,t,t,invite.id,t),
  query(env,'UPDATE portal_invitations SET consumed_by=? WHERE id=? AND consumed_by IS NULL AND EXISTS (SELECT 1 FROM portal_users WHERE id=?)',id,invite.id,id),
  auditStatement(env,{id},'invitation.accept',invite.id)
 ]);
 const u=await query(env,'SELECT * FROM portal_users WHERE id=?',id).first();if(!u)fail('Invitationen kunne ikke aktiveres.',409);
 return json({ok:true,next:'/app'},200,{'Set-Cookie':await establishLogin(env,u)});
}
async function handleExternalAuth(request,env){
 if(!externalLogin(env))return null;
 const url=new URL(request.url),path=url.pathname;
 if(path==='/login'&&['GET','HEAD'].includes(request.method))return loginDocument(request,env);
 if(!path.startsWith('/auth/'))return null;
 const origin=portalOrigin(request,env);
 if(!env.DB)fail('Login-databasen er ikke tilsluttet.',503);
 await query(env,'DELETE FROM portal_auth_tokens WHERE expires_at < ?',now()-86400000).run();
 if(path==='/auth/microsoft'&&request.method==='GET'){
  if(!entraReady(env))fail('Microsoft 365-login mangler opsætning. Kontakt administratoren.',503);
  const state=secretToken(),nonce=secretToken(),verifier=secretToken(),binding=secretToken(),t=now();
  const challenge=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  await limit(env,{id:'oauth_'+await digest(request.headers.get('cf-connecting-ip')||'unknown')},'start',20);
  await query(env,"INSERT INTO portal_auth_tokens(token_hash,kind,payload,expires_at) VALUES (?,'oauth',?,?)",await digest(state),JSON.stringify({nonce,verifier,binding:await digest(binding)}),t+600000).run();
  const target=new URL('https://login.microsoftonline.com/'+env.MS_TENANT_ID+'/oauth2/v2.0/authorize');target.search=new URLSearchParams({client_id:env.MS_CLIENT_ID,response_type:'code',redirect_uri:origin+'/auth/microsoft/callback',response_mode:'query',scope:'openid profile email',state,nonce,code_challenge:challenge,code_challenge_method:'S256',login_hint:env.MS_ADMIN_EMAIL||'anton@korsbjerg.dk',prompt:'select_account'}).toString();
  return new Response(null,{status:302,headers:{Location:target.href,'Set-Cookie':oauthCookie(binding),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
 }
 if(path==='/auth/microsoft/callback'&&request.method==='GET'){
  if(!entraReady(env))fail('Microsoft-login er ikke tilsluttet.',503);
  const state=url.searchParams.get('state'),binding=authCookie(request,'__Host-gardening-oauth');
  const row=state&&/^[a-f0-9]{64}$/.test(state)?await query(env,"SELECT * FROM portal_auth_tokens WHERE token_hash=? AND kind='oauth'",await digest(state)).first():null;
  if(!row||!binding||JSON.parse(row.payload).binding!==await digest(binding))fail('Loginforsøget passer ikke til denne browser. Start igen.',403);
  await claimAuthToken(env,state,'oauth');const data=JSON.parse(row.payload),code=url.searchParams.get('code');if(!code||code.length>10000||url.searchParams.has('error'))fail('Microsoft-login blev afbrudt. Start igen.',403);
  const response=await fetch('https://login.microsoftonline.com/'+env.MS_TENANT_ID+'/oauth2/v2.0/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.MS_CLIENT_ID,client_secret:env.MS_CLIENT_SECRET,grant_type:'authorization_code',code,code_verifier:data.verifier,redirect_uri:origin+'/auth/microsoft/callback'}),signal:AbortSignal.timeout(15000)});
  const tokens=await response.json();if(!response.ok||!tokens.id_token)fail('Microsoft kunne ikke bekræfte login. Start igen.',403);
  const claims=await verifyMicrosoftToken(tokens.id_token,env,data.nonce),id='microsoft_'+claims.tid.toLowerCase()+'_'+claims.oid.toLowerCase();
  await query(env,"INSERT OR IGNORE INTO portal_users(id,email,name,role,can_operate,active,gardens,created_at,updated_at) VALUES (?,?,?,'administrator',1,1,'[]',?,?)",id,(env.MS_ADMIN_EMAIL||'anton@korsbjerg.dk').toLowerCase(),'Anton Korsbjerg',now(),now()).run();
  const u=await query(env,'SELECT * FROM portal_users WHERE id=?',id).first();if(!u.active)fail('Din adgang er spærret.',403);
  await audit(env,u,'login.microsoft',id);const headers=new Headers({Location:'/kontor','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});headers.append('Set-Cookie',await establishLogin(env,u));headers.append('Set-Cookie',oauthCookie('',0));
  return new Response(null,{status:302,headers});
 }
 if(!['/auth/customer/link','/auth/customer/accept','/auth/customer/verify'].includes(path)||request.method!=='POST')return json({error:'Siden blev ikke fundet.'},404);
 checkOrigin(request);const body=await readBody(request,4000);
 await limit(env,{id:'authip_'+await digest(request.headers.get('cf-connecting-ip')||'unknown')},'attempt',20);
 if(path==='/auth/customer/accept')return acceptCustomerInvitation(request,env,body);
 if(path==='/auth/customer/link'){
  const email=String(body.email||'').trim().toLowerCase();if(!emailPattern.test(email)||email.length>254)fail('Angiv en gyldig mailadresse.');
  // Same response for unknown, blocked and known accounts; no account enumeration.
  const reply=()=>json({ok:true,message:'Hvis mailadressen har adgang, får du et loginlink. Tjek også uønsket mail.'});
  if(!env.RESEND_API_KEY||!env.MAIL_FROM)fail('Kundelogin via mail er ikke tilsluttet endnu. Kontakt Anton.',503);
  const existing=await query(env,"SELECT * FROM portal_users WHERE email=? AND role='customer' AND active=1",email).first();
  await limit(env,{id:'email_'+await digest(email)},'login',1);
  if(existing){const token=secretToken(),hash=await digest(token);await query(env,"INSERT INTO portal_auth_tokens(token_hash,kind,user_id,expires_at) VALUES (?,'customer',?,?)",hash,existing.id,now()+900000).run();
   try{await authEmail(env,email,'Dit login til Korsbjerg Gardening','Hej '+existing.name+'\n\nLog ind i din haveportal:\n'+origin+'/login#login='+token+'\n\nLinket kan bruges én gang og udløber efter 15 minutter. Videresend det ikke. Har du ikke bedt om login, kan du ignorere denne mail.\n\nAnton · Korsbjerg Gardening',hash)}catch{await query(env,'UPDATE portal_auth_tokens SET used_at=? WHERE token_hash=?',now(),hash).run()}
  }
  return reply();
 }
 const token=await claimAuthToken(env,body.token,'customer'),u=await query(env,"SELECT * FROM portal_users WHERE id=? AND role='customer' AND active=1",token.user_id).first();if(!u)fail('Din adgang er ikke aktiv.',403);
 await audit(env,u,'login.customer',u.id);return json({ok:true,next:'/app'},200,{'Set-Cookie':await establishLogin(env,u)});
}

function loginDocument(request,env){const content=loginHtml.replace('__LOGIN_CONFIG__',JSON.stringify({microsoft:entraReady(env)}));return new Response(request.method==='HEAD'?null:content,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"}})}
