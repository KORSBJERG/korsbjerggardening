let me=null,csrfToken='',accessData=null,accessError='';
async function apiFetch(path,options={}){
 const method=(options.method||'GET').toUpperCase();
 return fetch(path,{...options,credentials:'same-origin',headers:{...(options.headers||{}),...(!['GET','HEAD'].includes(method)?{'X-CSRF-Token':csrfToken}:{})}});
}
async function apiAction(path,body={}){
 const response=await apiFetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Handlingen kunne ikke gennemføres.');return data;
}
function loginLink(){return '/signin-with-chatgpt?return_to='+encodeURIComponent('/app'+location.hash)}
function accessGate(message,signIn=false){
 document.getElementById('sidebar').innerHTML='<a class="brand" href="/"><img class="brand-logo" src="/brand-logo.png" alt="Korsbjerg Gardening"></a>';
 document.getElementById('topbar').innerHTML='';
 document.getElementById('main').innerHTML='<div class="heading"><div><div class="eyebrow">KORSBJERG GARDENING</div><h1>Dit personlige arbejdsrum</h1><p>'+esc(message)+'</p></div></div><div class="panel panelpad">'+(signIn?'<a class="btn" target="_top" href="'+esc(loginLink())+'">Log ind med ChatGPT</a>':'<button class="btn" data-action="reload">Prøv igen</button>')+' <a class="btn light" href="/">Til hjemmesiden</a> <a class="textbtn" target="_top" href="/signout-with-chatgpt?return_to=%2Fapp">Skift konto</a></div>';
}
async function refreshPortal(){
 const r=await apiFetch('/api/state'),data=await r.json();if(!r.ok)throw Error(data.error);state=data.state;etag=data.etag;
 if(!state.gardens.some(g=>g.id===selectedGarden))selectedGarden=state.gardens[0]?.id||'';
}
async function boot(){
 loaded=false;try{
  const response=await apiFetch('/api/me');const data=await response.json();
  if(response.status===401){accessGate('Log ind for at se din have eller åbne havekontoret.',true);return}
  if(!response.ok)throw Error(data.error);
  const token=new URLSearchParams(location.hash.slice(1)).get('invite');
  if(token){await apiAction('/api/invitations/accept',{token});history.replaceState({},'','/app');return boot()}
  if(data.pending){accessGate('Du er logget ind som '+data.email+'. Bed Anton om en invitation til din have.');return}
  me=data.user;csrfToken=data.csrf;customerMode=me.role==='customer'||!me.canOperate;
  if(me.role==='administrator'&&!me.canOperate)page='access';else if(me.role==='customer')page='portal';
  if(me.role==='customer'&&!location.pathname.startsWith('/app'))history.replaceState({},'','/app');
  await refreshPortal();loaded=true;storageError='';render();
 }catch(error){loaded=false;accessGate(error.message)}
}
function save(){
 if(!me?.canOperate){toast('Denne ændring kræver adgang til havekontoret.');return Promise.resolve(false)}
 const snapshot=JSON.parse(JSON.stringify(state));saveQueue=saveQueue.then(async()=>{status('Gemmer…');try{
  const res=await apiFetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:snapshot,etag})});const data=await res.json();if(!res.ok)throw Error(data.error);
  etag=data.etag;if(data.state){state=data.state;if(!state.gardens.some(g=>g.id===selectedGarden))selectedGarden=state.gardens[0]?.id||''}storageError='';status('Alle ændringer er gemt');return true;
 }catch(e){storageError=e.message;status('Ikke gemt');toast(e.message+' Genindlæs for at hente de gemte data.');return false}});return saveQueue;
}
function invitationForm(){
 const admin=me.role==='administrator';
 modal('Inviter til Korsbjerg Gardening','<form id="accessInviteForm"><div class="formgrid">'+input('Navn','name','','text','maxlength="100"')+input('E-mail til login','email','','email','maxlength="254"')+(admin?commerceSelect('Adgang','role',[['customer','Kunde'],['anton','Anton / driftsansvarlig'],['administrator','Administrator']],'customer'):'<input type="hidden" name="role" value="customer">')+'</div><p>Vælg kundens haver. Flere personer kan inviteres til samme have.</p>'+state.gardens.map(g=>'<label class="checkout-complete"><input type="checkbox" name="gardens" value="'+esc(g.id)+'"> '+esc(g.name)+' · '+esc(g.customer)+'</label>').join('')+(admin?'<label class="checkout-complete"><input type="checkbox" name="canOperate"> Giv også administratoren adgang til havekontorets data</label>':'')+'<p class="checkout-help">Invitationen virker kun med den angivne login-e-mail og udløber efter 48 timer. Du får et link, som du selv kan sende.</p><div class="modal-actions"><button class="btn">Opret invitationslink</button></div></form>');
}
function accessPage(){
 if(!accessData&&!accessError){loadAccess();return heading('ADGANG','Brugere og invitationer','Henter adgangsoversigten…')}
 return heading('ADGANG','De rigtige mennesker. De rigtige haver.','Inviter kunder, tildel haver og luk adgang igen.',btn('Inviter bruger','inviteUser'))+(accessError?'<div class="notice">'+esc(accessError)+'</div>':'')+'<div class="panel panelpad"><h2>Brugere</h2>'+(accessData?.users||[]).map(u=>'<div class="settingrow"><div><b>'+esc(u.name)+'</b><p>'+esc(u.email)+' · '+esc(({administrator:'Administrator',anton:'Driftsansvarlig',customer:'Kunde'})[u.role])+' · '+(u.active?'Aktiv':'Spærret')+'</p><small>'+esc(u.gardens.map(id=>state.gardens.find(g=>g.id===id)?.name||id).join(', '))+'</small></div>'+(u.id!==me.id?'<button class="btn light" data-access-edit="'+esc(u.id)+'">Rediger adgang</button>':'<span>Din konto</span>')+'</div>').join('')+'</div><div class="panel panelpad" style="margin-top:20px"><h2>Invitationer</h2>'+(accessData?.invitations||[]).map(i=>'<div class="settingrow"><div><b>'+esc(i.name)+'</b><p>'+esc(i.email)+' · '+(i.revoked?'Tilbagekaldt':i.consumed_by?'Accepteret':i.expires_at<Date.now()?'Udløbet':'Afventer login')+'</p></div>'+(!i.revoked&&!i.consumed_by?'<button class="btn light" data-invite-revoke="'+esc(i.id)+'">Tilbagekald</button>':'')+'</div>').join('')+'</div>'+(me.role==='administrator'?'<div class="panel panelpad" style="margin-top:20px"><h2>Seneste adgangs- og datahændelser</h2>'+(accessData?.events||[]).slice(0,30).map(e=>'<p>'+esc(new Date(e.created_at).toLocaleString('da-DK'))+' · '+esc(e.action)+' · '+esc(accessData.users.find(u=>u.id===e.user_id)?.name||e.user_id)+'</p>').join('')+'</div>':'');
}
async function loadAccess(){try{const r=await apiFetch('/api/access');const d=await r.json();if(!r.ok)throw Error(d.error);accessData=d;accessError=''}catch(e){accessError=e.message}if(page==='access')render()}
function editAccess(id){
 const u=accessData.users.find(x=>x.id===id);if(!u)return;
 modal('Adgang for '+esc(u.name),'<form id="accessUserForm" data-id="'+esc(id)+'">'+(me.role==='administrator'?commerceSelect('Rolle','role',[['customer','Kunde'],['anton','Anton / driftsansvarlig'],['administrator','Administrator']],u.role):'<input type="hidden" name="role" value="customer">')+'<label class="checkout-complete"><input type="checkbox" name="active" '+(u.active?'checked':'')+'> Aktiv adgang</label>'+state.gardens.map(g=>'<label class="checkout-complete"><input type="checkbox" name="gardens" value="'+esc(g.id)+'" '+(u.gardens.includes(g.id)?'checked':'')+'> '+esc(g.name)+'</label>').join('')+(me.role==='administrator'?'<label class="checkout-complete"><input type="checkbox" name="canOperate" '+(u.canOperate?'checked':'')+'> Administrator må også bruge havekontoret</label>':'')+'<p>Ændringen lukker brugerens eksisterende app-sessioner.</p><div class="modal-actions"><button class="btn">Gem adgang</button></div></form>');
}
document.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b||!me)return;const d=b.dataset;
 const action=d.quoteAccept||d.quoteDecline||d.approve||d.decline;
 if(action){e.preventDefault();e.stopImmediatePropagation();if(me.role!=='customer'){toast('Godkendelse skal foretages fra kundens egen konto.');return}
  const quote=!!(d.quoteAccept||d.quoteDecline),accept=!!(d.quoteAccept||d.approve),obj=(quote?state.quotes:state.tasks).find(x=>x.id===action);
  try{b.disabled=true;await apiAction('/api/'+(quote?'quotes':'tasks')+'/'+encodeURIComponent(action)+'/'+(accept?'accept':'decline'),{version:obj?.updatedAt});await refreshPortal();close();render();toast('Dit svar er gemt.')}catch(error){toast(error.message);b.disabled=false}return;
 }
 if(d.action==='requestTask'){e.preventDefault();e.stopImmediatePropagation();modal('En ny opgave til Anton','<form id="customerRequestForm">'+input('Hvad skal der laves?','title','','text','maxlength="150"')+'<label>Beskrivelse<textarea class="input" name="note" maxlength="2000"></textarea></label><div class="modal-actions"><button class="btn">Send ønske</button></div></form>')}
 if(d.action==='inviteUser'){e.preventDefault();e.stopImmediatePropagation();invitationForm()}
 if(d.accessEdit){e.preventDefault();e.stopImmediatePropagation();editAccess(d.accessEdit)}
 if(d.inviteRevoke){e.preventDefault();e.stopImmediatePropagation();try{await apiAction('/api/access/invitations/'+encodeURIComponent(d.inviteRevoke)+'/revoke');await loadAccess()}catch(error){toast(error.message)}}
 if(d.action==='logout'){e.preventDefault();e.stopImmediatePropagation();try{await apiAction('/api/session/logout')}finally{location.href='/signout-with-chatgpt?return_to=%2F'}}
 if(d.logPublish){e.preventDefault();e.stopImmediatePropagation();if(!me.canOperate)return;const l=state.logs.find(x=>x.id===d.logPublish);if(l){l.customerVisible=!l.customerVisible;await save();render()}}
},true);
document.addEventListener('submit',async e=>{
 const form=e.target;
 if(form.id==='customerRequestForm'){e.preventDefault();e.stopImmediatePropagation();try{await apiAction('/api/requests',{garden:selectedGarden,title:new FormData(form).get('title'),note:new FormData(form).get('note')});await refreshPortal();close();render();toast('Dit opgaveønske er sendt til Anton.')}catch(error){toast(error.message)}return}
 if(form.id==='messageForm'){
  e.preventDefault();e.stopImmediatePropagation();if(!me)return;
  try{form.querySelector('button').disabled=true;await apiAction('/api/messages',{garden:selectedGarden,text:new FormData(form).get('text')});await refreshPortal();render();toast('Beskeden er gemt.')}catch(error){toast(error.message);form.querySelector('button').disabled=false}return;
 }
 if(!['accessInviteForm','accessUserForm'].includes(form.id))return;
 e.preventDefault();e.stopImmediatePropagation();const data=new FormData(form),button=form.querySelector('button');button.disabled=true;
 try{const payload={name:data.get('name'),email:data.get('email'),role:data.get('role'),gardens:data.getAll('gardens'),canOperate:data.has('canOperate'),active:data.has('active')};
  if(form.id==='accessInviteForm'){
   const result=await apiAction('/api/access/invitations',payload);await loadAccess();
   modal('Invitationen er klar','<p>Send dette link til <b>'+esc(payload.email)+'</b>. Det kan bruges én gang og udløber efter 48 timer.</p><label>Invitationslink<input class="input" readonly value="'+esc(result.url)+'" onclick="this.select()"></label><p class="checkout-help">Modtageren skal logge ind med præcis den inviterede e-mail. Linket er ikke sendt automatisk.</p>');
  }else{await apiAction('/api/access/user',{...payload,id:form.dataset.id});close();await loadAccess();toast('Adgangen er opdateret.')}
 }catch(error){toast(error.message);button.disabled=false}
},true);
