/* Generated for one app and deployment scope; never clear origin-wide storage. */
const PREFIX='provision:__APP__:staging:'+encodeURIComponent(self.registration.scope)+':';
const CACHE=PREFIX+'__REVISION__';
const SHELL=__SHELL__;
const URLS=new Set(SHELL.map(p=>new URL(p,self.registration.scope).href));
const HOME=new URL('./index.html',self.registration.scope).href;
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  try{await Promise.all(SHELL.map(async p=>{
    const url=new URL(p,self.registration.scope).href,response=await fetch(new Request(url,{cache:'reload',credentials:'omit'}));
    if(!response.ok||response.redirected||response.type==='opaque')throw Error('Incomplete shell');
    const type=response.headers.get('content-type')||'';
    if(url.endsWith('.html')&&!type.includes('text/html'))throw Error('Invalid entrypoint');
    if(url.endsWith('.js')&&!/(javascript|ecmascript)/.test(type))throw Error('Invalid script');
    if(url.endsWith('.css')&&!type.includes('text/css'))throw Error('Invalid stylesheet');
    await cache.put(url,response);
  }));}catch(e){await caches.delete(CACHE);throw e;}
})()));
self.addEventListener('message',event=>{if(event.data?.type==='APPLY_UPDATE')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const r=event.request;if(r.method!=='GET')return;
  const u=new URL(r.url),scope=new URL(self.registration.scope);
  if(u.origin!==scope.origin||u.search||r.headers.has('authorization'))return;
  const target=r.mode==='navigate'&&(u.href===scope.href||u.href===HOME)?HOME:u.href;
  if(!URLS.has(target))return;
  // Immutable complete shell only. API, private images and callback URLs never enter Cache Storage.
  event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(target))||fetch(r)));
});
