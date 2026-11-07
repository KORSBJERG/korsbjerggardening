function mailProvider(env){return env.MAIL_PROVIDER||(env.SMTP2GO_API_KEY?'smtp2go':'resend')}
function mailConfigured(env){return !!(env.MAIL_FROM&&(mailProvider(env)==='smtp2go'?env.SMTP2GO_API_KEY:mailProvider(env)==='resend'?env.RESEND_API_KEY:false))}
// One attempt only. An uncertain result must be checked in the provider dashboard,
// never retried automatically: SMTP2GO does not supply our application's dedupe.
async function deliverMail(env,{to,subject,text,attachments=[],idempotencyKey}){
 if(!mailConfigured(env))return {status:'failed',error:'Mailafsendelse er ikke tilsluttet.'};
 const smtp=mailProvider(env)==='smtp2go',headers={'Content-Type':'application/json',Accept:'application/json'};
 if(smtp)headers['X-Smtp2go-Api-Key']=env.SMTP2GO_API_KEY;else{headers.Authorization='Bearer '+env.RESEND_API_KEY;headers['Idempotency-Key']=idempotencyKey}
 const payload=smtp?{sender:env.MAIL_FROM,to:[to],subject,text_body:text,...(attachments.length?{attachments:attachments.map(a=>({filename:a.filename,fileblob:a.content,mimetype:'application/pdf'}))}:{})}:{from:env.MAIL_FROM,to:[to],subject,text,...(attachments.length?{attachments}:{})};
 try{
  const response=await fetch(smtp?'https://eu-api.smtp2go.com/v3/email/send':'https://api.resend.com/emails',{method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)});
  const result=await response.json(),data=result?.data;
  const accepted=response.ok&&(smtp?data?.succeeded===1&&data?.failed===0&&(!data.failures||Array.isArray(data.failures)&&data.failures.length===0)&&typeof data.email_id==='string'&&!!data.email_id:typeof result?.id==='string'&&!!result.id);
  if(accepted)return {status:'accepted',provider:mailProvider(env),providerId:smtp?data.email_id:result.id,providerStatus:response.status,acceptedAt:new Date().toISOString()};
  const rejected=response.status>=400&&response.status<500||smtp&&data?.succeeded===0&&(data.failed>0||data.error_code);
  return {status:rejected?'failed':'unknown',provider:mailProvider(env),providerStatus:response.status,error:rejected?'Mailtjenesten afviste afsendelsen. Kontroller afsender, modtager og opsætning.':'Afsendelsesstatus er ukendt. Kontroller mailtjenesten før en ny afsendelse.'};
 }catch{return {status:'unknown',provider:mailProvider(env),error:'Afsendelsesstatus er ukendt. Kontroller mailtjenesten før en ny afsendelse.'}}
}
async function transactionalMail(env,message){
 if(!mailConfigured(env))fail('Mailafsendelse er ikke tilsluttet endnu. Brug en mailkladde til invitationer.',503);
 if(!env.BUCKET)fail('Mailens kvitteringslager er ikke tilsluttet.',503);
 const hash=await digest(JSON.stringify({to:message.to,subject:message.subject,text:message.text})),key='gardening-business/login-mail/'+await digest(message.idempotencyKey)+'.json';
 const previous=await env.BUCKET.get(key);
 if(previous){const receipt=await previous.json();if(receipt.hash!==hash)fail('Afsendelsen er allerede brugt til en anden besked.',409);if(receipt.status==='accepted')return receipt.providerId;fail('Afsendelsen er allerede behandlet eller har ukendt status. Kontroller mailtjenesten før du prøver igen.',409)}
 const pending={hash,status:'pending',createdAt:new Date().toISOString()};
 if(!await env.BUCKET.put(key,JSON.stringify(pending),{onlyIf:{etagDoesNotMatch:'*'}}))fail('Mailen er allerede ved at blive sendt.',409);
 const result=await deliverMail(env,message);await env.BUCKET.put(key,JSON.stringify({...pending,...result}));
 if(result.status!=='accepted')fail(result.error,502);
 return result.providerId;
}
