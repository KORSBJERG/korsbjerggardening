// Shared address-based maps. Coordinates are optional and explicitly entered by Anton.
let gardenMapLayer='satellite';
function mapPosition(g){
  const p=g?.mapPosition;
  return p&&p.address===g.address&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180?p:null;
}
function mapQuery(g){const p=mapPosition(g);return p?p.lat+','+p.lng:String(g?.address||'').trim();}
function mapLinks(g){const q=encodeURIComponent(mapQuery(g));return {view:'https://www.google.com/maps/search/?api=1&query='+q,route:'https://www.google.com/maps/dir/?api=1&destination='+q};}
function gardenMap(g,compact=false){
  if(!mapQuery(g))return '<div class="map-empty">Tilføj havens fulde adresse for at vise kortet.</div>';
  const src='https://www.google.com/maps?q='+encodeURIComponent(mapQuery(g))+'&output=embed&hl=da&z='+(compact?14:19)+'&t='+(gardenMapLayer==='satellite'?'k':'m');
  return '<div class="live-garden-map '+(compact?'compact':'')+'"><iframe title="'+esc((gardenMapLayer==='satellite'?'Luftfoto af ':'Kort over ')+g.name)+'" src="'+esc(src)+'" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>';
}
function gardenMapPicker(){return '<label class="map-picker">Vælg have<select class="input" id="gardenSelect">'+state.gardens.map(g=>'<option value="'+esc(g.id)+'" '+(g.id===selectedGarden?'selected':'')+'>'+esc(g.name)+'</option>').join('')+'</select></label>';}
function mapSvg(){
  const g=state.gardens.find(g=>g.id===selectedGarden)||state.gardens[0];
  if(!g)return '<div class="map-empty">Opret en have for at se dens placering.</div>';
  return gardenMapPicker()+gardenMap(g,true)+'<p class="map-address">'+esc(g.address||'Adresse mangler')+'</p>';
}
function mapPage(){
  const g=state.gardens.find(g=>g.id===selectedGarden)||state.gardens[0];
  if(!g)return heading('HAVEKORT','Dine haver på kortet.','Opret en have med en adresse for at komme i gang.');
  selectedGarden=g.id;
  const links=mapLinks(g),p=mapPosition(g),jobs=state.tasks.filter(t=>t.garden===g.id);
  return heading('HAVEKORT','Den rigtige have. Helt tæt på.','Kort, luftfoto og vej til næste opgave.')+
    '<div class="toolbar map-toolbar">'+gardenMapPicker()+'<div class="map-layers" role="group" aria-label="Kortvisning"><button class="btn '+(gardenMapLayer==='street'?'':'light')+'" data-map-layer="street" aria-pressed="'+(gardenMapLayer==='street')+'">Vejkort</button><button class="btn '+(gardenMapLayer==='satellite'?'':'light')+'" data-map-layer="satellite" aria-pressed="'+(gardenMapLayer==='satellite')+'">Luftfoto</button></div></div>'+
    '<div class="columns"><div>'+gardenMap(g)+'<div class="map-actions"><a class="btn" href="'+links.route+'" target="_blank" rel="noopener noreferrer">'+icon('pin')+'Start rute</a><a class="btn light" href="'+links.view+'" target="_blank" rel="noopener noreferrer">Åbn i Google Maps ↗</a>'+(!customerMode?'<button class="btn light" data-map-edit="'+esc(g.id)+'">Ret adresse / kortnål</button>':'')+'</div><p class="map-note">'+(p?'Kortnålen er indstillet af Anton.':'Kortet søger på havens adresse. Tjek vejnavn, husnummer, postnummer og by, hvis placeringen ikke passer.')+' Luftfotoets alder og skarphed afhænger af Google Maps. Havegrænser er ikke opmålt.</p>'+section('Arbejdet i haven','','Se opgaver',customerMode?'visits':'tasks')+'<div class="panel">'+(jobs.length?jobs.map(taskRow).join(''):'<p class="map-empty">Der er ingen opgaver på denne have endnu.</p>')+'</div></div><div><div class="aside-card"><div class="eyebrow">DIN VALGTE HAVE</div><h2 style="font:27px Georgia">'+esc(g.name)+'</h2><p class="map-note">'+esc(g.address||'Adresse mangler')+'<br>'+esc(g.customer)+'</p><hr><h3>Registrerede oplysninger</h3><p class="map-note">Haveareal: '+fmt(g.area||0)+' m²<br>Aftalt tid: '+fmt(g.budget||0)+' timer pr. måned<br>Registreret: '+fmt(total(g.id))+' timer</p><p class="map-note">Arealet kommer fra havens oplysninger. Det er ikke beregnet fra luftfotoet.</p></div><div class="aside-card" style="margin-top:20px"><h3>Skift have</h3>'+state.gardens.map(x=>'<button class="map-garden-link '+(x.id===g.id?'selected':'')+'" data-map-garden="'+esc(x.id)+'"><strong>'+esc(x.name)+'</strong><span>'+esc(x.address||'Adresse mangler')+'</span></button>').join('')+'</div></div></div>';
}
function editGardenMap(id){
  if(customerMode)return;
  const g=state.gardens.find(g=>g.id===id);if(!g)return;const p=mapPosition(g);
  modal('Havens adresse og kortnål','<form id="gardenMapForm" data-id="'+esc(id)+'"><label class="map-field">Fuld adresse<input class="input" name="address" required maxlength="250" autocomplete="street-address" value="'+esc(g.address||'')+'" placeholder="Vejnavn 12, 8420 Knebel"></label><p class="map-note">Adressen bruges til kort og rutevejledning. Angiv husnummer, postnummer og by.</p><label class="map-field">Præcis kortnål (valgfri)<input class="input" name="coordinates" value="'+(p?p.lat+', '+p.lng:'')+'" placeholder="56.21345, 10.45123" autocomplete="off"></label><p class="map-note">Åbn Google Maps, find indkørslen og højreklik på punktet (hold fingeren nede på mobil). Kopiér breddegrad og længdegrad hertil. Lad feltet stå tomt for at bruge adressen.</p><a class="textbtn" href="'+mapLinks(g).view+'" target="_blank" rel="noopener noreferrer">Find punktet i Google Maps ↗</a><p id="mapFormError" role="alert" class="map-error"></p><div class="modal-actions"><button class="btn light" type="button" data-action="close">Annuller</button><button class="btn">Gem placering</button></div></form>');
}
function parseMapCoordinates(value){
  if(!value.trim())return null;
  const parts=value.trim().split(/\s*,\s*/);
  if(parts.length!==2||parts.some(v=>!/^[-+]?\d+(?:\.\d+)?$/.test(v)))throw Error('Brug to koordinater med punktum som decimaltegn, fx 56.21345, 10.45123.');
  const [lat,lng]=parts.map(Number);
  if(Math.abs(lat)>90||Math.abs(lng)>180)throw Error('Breddegrad skal være mellem −90 og 90, længdegrad mellem −180 og 180.');
  return {lat,lng};
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-map-edit],[data-map-layer],[data-map-garden]');if(!b||!loaded||commerceBusy||attendanceBusy||mailBusy)return;
  if(b.dataset.mapEdit)editGardenMap(b.dataset.mapEdit);
  if(b.dataset.mapLayer){gardenMapLayer=b.dataset.mapLayer;render();}
  if(b.dataset.mapGarden&&state.gardens.some(g=>g.id===b.dataset.mapGarden)){selectedGarden=b.dataset.mapGarden;render();}
});
document.addEventListener('submit',async e=>{
  if(e.target.id!=='gardenMapForm')return;e.preventDefault();
  if(customerMode||!loaded||commerceBusy||attendanceBusy||mailBusy)return;
  const form=e.target,g=state.gardens.find(g=>g.id===form.dataset.id);if(!g)return;
  const v=Object.fromEntries(new FormData(form));
  try{const point=parseMapCoordinates(v.coordinates),address=v.address.trim();if(!address)throw Error('Angiv en adresse.');
    await commercialChange(()=>{g.address=address;if(point)g.mapPosition={...point,address,updatedAt:new Date().toISOString()};else delete g.mapPosition;},'Havens placering er gemt.');
  }catch(error){form.querySelector('#mapFormError').textContent=error.message;}
});
