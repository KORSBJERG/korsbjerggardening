import gardening from '../dist/server/index.js';

// Standalone Cloudflare hosts the marketing website. Sites remains responsible
// for authenticated office/customer routes and their existing R2 data.
const defaultPortal='https://antons-korsbjerg-gardening.peaknet.chatgpt.site';
export default {async fetch(request,env={},ctx){
 const url=new URL(request.url);
 if(env.PORTAL_AUTH_MODE==='microsoft'){
  const headers=new Headers(request.headers);for(const name of Array.from(headers.keys()))if(name.startsWith('oai-authenticated-')||name==='oai-sites-authorization')headers.delete(name);
  return gardening.fetch(new Request(request,{headers}),env,ctx);
 }
 if(url.pathname==='/api'||url.pathname.startsWith('/api/')){
  return Response.json({error:'App APIs are available only through the authenticated portal.'},{status:404,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
 }
 const portalRoute=url.pathname==='/app'||url.pathname.startsWith('/app/')||url.pathname==='/kontor'||url.pathname.startsWith('/kontor/');
 if(portalRoute){
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD','Cache-Control':'no-store'}});
  let portal;try{portal=new URL(env.PORTAL_ORIGIN||defaultPortal);if(portal.protocol!=='https:'||portal.username||portal.password||portal.origin===url.origin)throw Error('Invalid portal origin')}catch{return new Response('The protected portal address is not configured correctly.',{status:503,headers:{'Cache-Control':'no-store'}})}
  return new Response(null,{status:302,headers:{Location:portal.origin+url.pathname+url.search,'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
 }
 // Public requests cannot supply the trusted identity headers injected by Sites.
 const headers=new Headers(request.headers);
 for(const name of Array.from(headers.keys()))if(name.startsWith('oai-authenticated-')||name==='oai-sites-authorization')headers.delete(name);
 const publicRequest=new Request(request,{headers});
 return gardening.fetch(publicRequest,{PUBLIC_SITE_URL:env.PUBLIC_SITE_URL},ctx);
}};
