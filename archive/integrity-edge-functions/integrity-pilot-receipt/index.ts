// Signed provider callback. Only the nominated staging reservation lane is retained.
// Only delivery events; no inbound messages, raw payload retention, or client identity.
const ROOT='https://qaaskvbhssonbktdjdki.supabase.co';
const TYPES=new Set(['email.sent','email.delivered','email.bounced','email.complained','email.failed','email.suppressed','email.delivery_delayed']);
function bytes(s:string){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
export async function verify(raw:string,headers:Headers,secret:string,now=Date.now()){
 const id=headers.get('svix-id'),stamp=headers.get('svix-timestamp'),signatures=headers.get('svix-signature');
 if(!id||id.length>200||!stamp||!/^\d+$/.test(stamp)||Math.abs(now/1000-Number(stamp))>300||!signatures||signatures.length>2000)throw Error('SIGNATURE_INVALID');
 const key=await crypto.subtle.importKey('raw',bytes(secret.replace(/^whsec_/,'')),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const message=new TextEncoder().encode(id+'.'+stamp+'.'+raw);
 let valid=false;
 for(const entry of signatures.split(' ')){const [version,sig]=entry.split(',');if(version==='v1'&&sig){try{if(await crypto.subtle.verify('HMAC',key,bytes(sig),message))valid=true;}catch{}}}
 if(!valid)throw Error('SIGNATURE_INVALID');return id;
}
async function boundedBody(req:Request){
 if(Number(req.headers.get('content-length')||'0')>16384||!req.body)throw Error('BODY_INVALID');
 const reader=req.body.getReader();let length=0;const chunks:Uint8Array[]=[];
 let timer:ReturnType<typeof setTimeout>;
 try{return await Promise.race([(async()=>{while(true){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>16384)throw Error('BODY_INVALID');chunks.push(r.value);}const b=new Uint8Array(length);let i=0;for(const c of chunks){b.set(c,i);i+=c.length;}return new TextDecoder('utf-8',{fatal:true}).decode(b);})(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('BODY_TIMEOUT')),3000);})]);}
 finally{clearTimeout(timer!);await reader.cancel().catch(()=>{});}
}
export async function handler(req:Request){
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 if(req.method!=='POST')return Response.json({code:'METHOD_NOT_ALLOWED'},{status:405,headers});
 const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),secret=Deno.env.get('RESEND_WEBHOOK_SECRET');
 if(Deno.env.get('SUPABASE_URL')!==ROOT||!service||!secret)return Response.json({code:'NOT_CONFIGURED'},{status:503,headers});
 let raw:string,event:any,id:string;
 try{raw=await boundedBody(req);id=await verify(raw,req.headers,secret);event=JSON.parse(raw);}
 catch{return Response.json({code:'INVALID_CALLBACK'},{status:400,headers});}
 const d=event?.data;
 if(!Array.isArray(d?.to)||d.to.length!==1||typeof d.to[0]!=='string'||d.tags?.lane!=='provision_staging_reservation'||d.from!=='Provision <updates@notify.codifiedresonance.com>')return Response.json({ignored:true},{headers});
 const recipientHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(d.to[0].toLowerCase()))),x=>x.toString(16).padStart(2,'0')).join('');
 if(recipientHash!=='34272b7402c65f42114d59c79eeaa349711683750f42a24d5e2c31b927cd7890')return Response.json({ignored:true},{headers});
 if(!TYPES.has(event?.type))return Response.json({ignored:true},{headers});
 if(typeof event?.data?.email_id!=='string'||event.data.email_id.length>200||typeof event?.created_at!=='string'||!Number.isFinite(Date.parse(event.created_at)))return Response.json({code:'INVALID_EVENT'},{status:400,headers});
 try{
  const r=await fetch(ROOT+'/rest/v1/rpc/integrity_record_delivery_receipt_v1',{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify({p_event_id:id,p_provider_id:event.data.email_id,p_event_type:event.type,p_occurred_at:event.created_at}),signal:AbortSignal.timeout(3000)});
  // Acknowledge only after durable storage. A failed transaction prompts provider retry.
  if(!r.ok)return Response.json({code:'RECORD_UNAVAILABLE'},{status:503,headers});
  return Response.json({recorded:true},{headers});
 }catch{return Response.json({code:'RECORD_UNAVAILABLE'},{status:503,headers});}
}
if(typeof Deno!=='undefined')Deno.serve(handler);
