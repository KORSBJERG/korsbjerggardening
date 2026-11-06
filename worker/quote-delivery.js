const emailPattern=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/;
function encodeBytes(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s)}
const encodeUtf8=s=>encodeBytes(new TextEncoder().encode(s));
function mimeSubject(s){const parts=[];let chunk='';for(const c of s){if(new TextEncoder().encode(chunk+c).length>42){parts.push(chunk);chunk=c}else chunk+=c}if(chunk)parts.push(chunk);return parts.map(p=>'=?UTF-8?B?'+encodeUtf8(p)+'?=').join('\r\n ')}
function mimeDraft(q,company,body,pdf){const boundary='korsbjerg_'+crypto.randomUUID().replaceAll('-',''),lines=s=>s.match(/.{1,76}/g)?.join('\r\n')||'';return ['X-Unsent: 1','MIME-Version: 1.0','To: '+body.to,'From: '+(emailPattern.test(company.email)?company.email:'Gardening@Korsbjerg.dk'),'Subject: '+mimeSubject(body.subject),'Content-Type: multipart/mixed; boundary="'+boundary+'"','','--'+boundary,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',lines(encodeUtf8(body.message)),'--'+boundary,'Content-Type: application/pdf; name="'+quoteFileName(q)+'"','Content-Disposition: attachment; filename="'+quoteFileName(q)+'"','Content-Transfer-Encoding: base64','',lines(encodeBytes(pdf)),'--'+boundary+'--',''].join('\r\n')}
async function handleQuoteRoutes(request,env,u){
 const url=new URL(request.url);if(!url.pathname.startsWith('/api/quotes/')&&url.pathname!=='/api/mail/status')return null;
 if(!u)fail('Log ind for at hente eller sende tilbud.',401);
 if(!operates(u)&&url.pathname==='/api/mail/status')fail('Kun havekontoret har adgang til mailopsætning.',403);
 if(url.pathname==='/api/mail/status'&&request.method==='GET')return json({configured:!!(env.RESEND_API_KEY&&env.MAIL_FROM),from:env.MAIL_FROM||'Gardening@Korsbjerg.dk'});
 const match=url.pathname.match(/^\/api\/quotes\/([A-Za-z0-9_-]{1,120})\/(pdf|email|mail-draft|mail-status)$/);if(!match)return json({error:'Siden blev ikke fundet.'},404);
 if(!env.BUCKET)return json({error:'Datalageret er ikke tilgængeligt.'},503);
 const [,id,action]=match;const {state}=await sharedState(env,u);const q=state.quotes?.find(q=>q.id===id);if(!q)fail('Tilbuddet blev ikke fundet.',404);
 requireGarden(state,u,q.garden);
 if(!operates(u)&&(action!=='pdf'||q.status==='Kladde'))fail('Tilbuddet blev ikke fundet.',404);
 await limit(env,u,action==='email'?'email':'documents',action==='email'?10:60);
 if(!Array.isArray(q.items)||q.items.length<1||q.items.length>200||!q.items.every(l=>Number.isFinite(Number(l.quantity))&&Number(l.quantity)>0&&Number.isFinite(Number(l.unitPrice))&&Number(l.unitPrice)>=0)||!Number.isFinite(Number(q.vat))||Number(q.vat)<0||Number(q.vat)>100||!Number.isFinite(Number(q.discount))||Number(q.discount)<0||Number(q.discount)>100||!Number.isSafeInteger(pdfQuoteTotals(q).total)||!/^\d{4}-\d{2}-\d{2}$/.test(q.date))return json({error:'Kontroller tilbudslinjer, dato, rabat og moms.'},400);
 const company={...PDF_COMPANY,...(q.company||state.company||{})};const latestKey='gardening-business/mail-latest/'+id+'.json';
 if(action==='mail-status'&&request.method==='GET'){let latest=await env.BUCKET.get(latestKey);if(!latest){const origin=await query(env,"SELECT migrated_from FROM portal_state WHERE id='business'").first();if(origin?.migrated_from)latest=await env.BUCKET.get(origin.migrated_from.replace(/\.json$/,'')+'/mail-latest/'+id+'.json')}return json({receipt:latest?await latest.json():null})}
 if(action==='pdf'&&request.method==='GET'){try{const pdf=await createQuotePdf(q,company);return new Response(pdf,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+quoteFileName(q)+'"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})}catch{return json({error:'PDF kunne ikke oprettes. Kontroller tilbuddet.'},500)}}
 if(request.method!=='POST'||!['email','mail-draft'].includes(action))return json({error:'Metoden er ikke understøttet.'},405);
 if(request.headers.get('origin')!==url.origin)return json({error:'Ugyldig oprindelse.'},403);
 const body=await readBody(request,16000);
 if(!emailPattern.test(String(body.to||''))||body.to.length>254||typeof body.subject!=='string'||!body.subject.trim()||body.subject.length>200||/[\r\n]/.test(body.subject)||typeof body.message!=='string'||body.message.length>6000)return json({error:'Kontroller modtager, emne og besked.'},400);
 if(action==='email')await audit(env,u,'quote.email',id);
 if(action==='mail-draft'){const pdf=await createQuotePdf(q,company);return new Response(mimeDraft(q,company,body,pdf),{headers:{'Content-Type':'message/rfc822','Content-Disposition':'attachment; filename="'+quoteFileName(q).replace('.pdf','.eml')+'"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})}
 if(!env.RESEND_API_KEY||!env.MAIL_FROM)return json({error:'Automatisk mailafsendelse er ikke tilsluttet. Hent en mailkladde med PDF, og send den fra dit mailprogram.',code:'mail_not_configured'},503);
 if(q.status==='Kladde')return json({error:'Gør tilbuddet klar, før det sendes. Tilbudspriserne skal være låst.'},409);
 if(!/^[0-9a-f-]{36}$/.test(body.requestId||''))return json({error:'Afsendelses-id mangler.'},400);
 const attemptKey='gardening-business/mail-attempts/'+body.requestId+'.json';
 const identity=JSON.stringify({quote:id,to:body.to,subject:body.subject,message:body.message});
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity)))).map(v=>v.toString(16).padStart(2,'0')).join('');
 const previous=await env.BUCKET.get(attemptKey);if(previous){const receipt=await previous.json();if(receipt.hash!==hash)return json({error:'Denne afsendelse er allerede brugt til en anden besked.'},409);return json({receipt,accepted:receipt.status==='accepted'},receipt.status==='accepted'?200:409)}
 const receipt={requestId:body.requestId,quoteId:id,to:body.to,subject:body.subject,hash,status:'pending',createdAt:new Date().toISOString()};
 const claim=await env.BUCKET.put(attemptKey,JSON.stringify(receipt),{onlyIf:{etagDoesNotMatch:'*'}});if(!claim)return json({error:'Afsendelsen behandles allerede. Der sendes ikke en ekstra mail.'},409);
 try{
  const pdf=await createQuotePdf(q,company);const provider=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'quote/'+body.requestId},body:JSON.stringify({from:env.MAIL_FROM,to:[body.to],subject:body.subject,text:body.message,attachments:[{filename:quoteFileName(q),content:encodeBytes(pdf)}]}),signal:AbortSignal.timeout(25000)});const result=await provider.json();
  if(!provider.ok||!result.id){receipt.status='failed';receipt.error='Mailtjenesten afviste afsendelsen. Kontroller opsætning og modtager.';receipt.providerStatus=provider.status}else{receipt.status='accepted';receipt.providerId=result.id;receipt.acceptedAt=new Date().toISOString()}
 }catch{receipt.status='unknown';receipt.error='Afsendelsesstatus er ukendt. Kontroller mailtjenesten før en ny afsendelse.'}
 await env.BUCKET.put(attemptKey,JSON.stringify(receipt));await env.BUCKET.put(latestKey,JSON.stringify(receipt));return json({receipt,accepted:receipt.status==='accepted',error:receipt.error},receipt.status==='accepted'?200:502);
}
