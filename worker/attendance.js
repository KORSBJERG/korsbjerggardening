let attendanceBusy=false;
const localDay=timestamp=>new Date(timestamp).toLocaleDateString('sv-SE',{timeZone:'Europe/Copenhagen'});
const clockTime=timestamp=>new Date(timestamp).toLocaleTimeString('da-DK',{timeZone:'Europe/Copenhagen',hour:'2-digit',minute:'2-digit'});
function elapsedLabel(seconds){return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(v=>String(v).padStart(2,'0')).join(':')}
function attendanceControl(t){
 if(customerMode)return '';
 if(state.timer?.taskId===t.id)return '<button class="attendance-btn out" data-checkout="'+t.id+'">'+icon('stop')+'Tjek ud</button>';
 if(t.status==='Afsluttet'||t.status==='Afventer godkendelse')return '';
 return '<button class="attendance-btn" data-checkin="'+t.id+'" '+(state.timer?'disabled title="Tjek ud af den aktive opgave først"':'')+'>'+icon('play')+'Tjek ind</button>';
}
function attendanceBanner(){
 if(customerMode||!state.timer)return '';
 const t=state.timer;
 return '<section class="attendance-banner" aria-label="Aktiv indtjekning"><div class="attendance-info"><span class="live-dot"></span><div><div class="eyebrow">DU ER TJEKKET IND</div><strong>'+esc(t.task)+'</strong><p>'+esc(garden(t.garden).name)+' · Startet '+date(localDay(t.start))+' kl. '+clockTime(t.start)+'</p></div></div><div class="attendance-actions"><strong class="live-clock" data-live-clock>00:00:00</strong><button class="btn" data-action="stopTimer">'+icon('stop')+'Tjek ud</button></div></section>';
}
async function checkIn(id){
 if(customerMode||attendanceBusy)return;attendanceBusy=true;
 try{await apiAction('/api/attendance/checkin',{taskId:id});await refreshPortal();close();render();toast('Du er tjekket ind. Tiden kører.')}catch(error){toast(error.message)}finally{attendanceBusy=false}
}
function openCheckOut(){
 if(customerMode||attendanceBusy||!state.timer)return;
 const t=state.timer;const end=Date.now();const seconds=Math.max(1,Math.round((end-t.start)/1000));
 const task=state.tasks.find(item=>item.id===t.taskId);
 modal('Godt arbejde. Tjek ud.', '<form id="checkoutForm" data-end="'+end+'" data-session="'+esc(t.sessionId||String(t.start))+'"><div class="checkout-summary"><div class="eyebrow">'+esc(garden(t.garden).name)+'</div><h3>'+esc(t.task)+'</h3><strong>'+elapsedLabel(seconds)+'</strong><p>'+date(localDay(t.start))+' · '+clockTime(t.start)+' → '+clockTime(end)+'</p></div><label>Hvad fik du lavet?<textarea class="input wide" name="note" rows="3" maxlength="2000" placeholder="Fx klippet hæk og ryddet grønt affald" style="margin-top:8px"></textarea></label>'+(task?'<label class="checkout-complete"><input type="checkbox" name="complete" checked> Opgaven er færdig</label><p class="checkout-help">Fjern markeringen, hvis du skal fortsætte en anden dag.</p>':'')+'<label class="checkout-complete"><input type="checkbox" name="customerVisible" checked> Del tidsregistrering og note med kunden</label><p class="checkout-help">Tiden ovenfor gemmes ved bekræftelse. Annullerer du, fortsætter timeren.</p><div class="modal-actions"><button type="button" class="btn light" data-action="close">Fortsæt arbejdet</button><button class="btn" type="submit">'+icon('check')+'Tjek ud & gem tid</button></div></form>');
}
async function confirmCheckOut(form){
 if(customerMode||attendanceBusy||!state.timer)return;
 const data=new FormData(form);attendanceBusy=true;form.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);
 try{await apiAction('/api/attendance/checkout',{sessionId:form.dataset.session,note:String(data.get('note')||''),complete:data.has('complete'),customerVisible:data.has('customerVisible')});await refreshPortal();close();render();toast('Tiden er gemt.')}catch(error){toast(error.message);form.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=false)}finally{attendanceBusy=false}
}
