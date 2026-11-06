import { html } from './ui.js';
const json=(v,status=200,headers={})=>Response.json(v,{status,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow',...headers}});
export default {async fetch(request,env){
 const url=new URL(request.url);
 const delivery=await handleQuoteRoutes(request,env);if(delivery)return delivery;
 if(url.pathname==='/brand-logo.png'&&request.method==='GET')return new Response(Uint8Array.from(atob(logoBase64),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}});
 if(url.pathname==='/api/state'){
  if(!env.BUCKET)return json({error:'Datalageret er ikke tilgængeligt.'},503);
  const user=request.headers.get('oai-authenticated-user-id');
  if(!user)return json({error:'Log ind for at gemme og hente oplysninger.'},401);
  const key='gardening/'+encodeURIComponent(user)+'.json';
  if(request.method==='GET'){const obj=await env.BUCKET.get(key);return json({state:obj?await obj.json():null,etag:obj?.etag||null});}
  if(request.method==='PUT'){
   if(request.headers.get('origin')!==url.origin)return json({error:'Ugyldig oprindelse.'},403);
   if(Number(request.headers.get('content-length')||0)>500000)return json({error:'For mange data.'},413);
   try{const raw=await request.text();if(raw.length>500000)return json({error:'For mange data.'},413);const body=JSON.parse(raw);
    if(!body.state||!Array.isArray(body.state.tasks)||!Array.isArray(body.state.gardens)||!Array.isArray(body.state.logs)||!Array.isArray(body.state.messages))return json({error:'Ugyldige data.'},400);
    const result=await env.BUCKET.put(key,JSON.stringify(body.state),{onlyIf:body.etag?{etagMatches:body.etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
    if(!result)return json({error:'Oplysningerne er ændret i et andet vindue. Genindlæs siden, før du prøver igen.'},409);
    return json({etag:result.etag});
   }catch{return json({error:'Kunne ikke gemme oplysningerne.'},400);}
  }
  return json({error:'Metoden er ikke understøttet.'},405);
 }
 if(!['GET','HEAD'].includes(request.method))return new Response('Not found',{status:404});
 let origin=url.origin;try{if(env.PUBLIC_SITE_URL){const configured=new URL(env.PUBLIC_SITE_URL);if(configured.protocol==='https:'&&!configured.username&&!configured.password)origin=configured.origin}}catch{}
 if(url.pathname.length>1&&url.pathname.endsWith('/')&&seoDocuments[url.pathname.slice(0,-1)])return Response.redirect(origin+url.pathname.slice(0,-1)+url.search,308);
 if(url.pathname==='/robots.txt')return new Response('User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /kontor\nDisallow: /api/\nSitemap: '+origin+'/sitemap.xml\n',{headers:{'Content-Type':'text/plain; charset=utf-8'}});
 if(url.pathname==='/sitemap.xml')return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+['/',...Object.keys(seoDocuments)].map(path=>'<url><loc>'+origin+path+'</loc></url>').join('')+'</urlset>',{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=3600'}});
 const office=url.pathname==='/kontor'||url.pathname.startsWith('/kontor/')||url.pathname==='/app'||url.pathname.startsWith('/app/');
 if(url.pathname!=='/'&&!office&&!seoDocuments[url.pathname])return new Response('<!doctype html><html lang="da"><meta charset="utf-8"><title>Siden findes ikke</title><body style="background:#f5f4ec;color:#203e32;font:22px Georgia;padding:10vw"><h1>Siden findes ikke.</h1><p><a href="/">Tilbage til Korsbjerg Gardening</a></p></body></html>',{status:404,headers:{'Content-Type':'text/html; charset=utf-8','X-Robots-Tag':'noindex'}});
 const document=office?html:(seoDocuments[url.pathname]||frontHtml).replaceAll('__SITE_ORIGIN__',origin);
 return new Response(request.method==='HEAD'?null:document,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':office?'no-store':'public, max-age=0, must-revalidate','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin',...(office?{'X-Robots-Tag':'noindex, nofollow'}:{})}});
}};
