import {sendIntent} from './adapter.mjs';
const root='https://qaaskvbhssonbktdjdki.supabase.co';
const uid='f0eb980e-e29b-4820-af58-329e9560aaec';
const expected='34272b7402c65f42114d59c79eeaa349711683750f42a24d5e2c31b927cd7890';
async function hash(s:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,'0')).join('')}
Deno.serve(async req=>{
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),apiKey=Deno.env.get('PROVISION_RESEND_SEND_KEY');
 const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
 if(!key||Deno.env.get('SUPABASE_URL')!==root||req.headers.get('Authorization')!=='Bearer '+key)return response({code:'FORBIDDEN'},403);
 if(req.method!=='POST')return response({code:'POST_REQUIRED'},405);
 const h={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
 async function rpc(name:string,body:unknown){const r=await fetch(root+'/rest/v1/rpc/'+name,{method:'POST',headers:h,body:JSON.stringify(body),signal:AbortSignal.timeout(6000)});if(!r.ok)throw Error('RPC_UNAVAILABLE');return await r.json()}
 async function recipient(){const r=await fetch(root+'/auth/v1/admin/users/'+uid,{headers:h,signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error('IDENTITY_UNAVAILABLE');const u=await r.json();const email=u.email?.toLowerCase();return u.id===uid&&u.email_confirmed_at&&!u.deleted_at&&!(Date.parse(u.banned_until)>Date.now())&&typeof email==='string'&&await hash(email)===expected?email:null}
 try{
  const body=await req.json();
  if(body?.action==='check')return response({worker_key_configured:!!apiKey,webhook_key_configured:!!Deno.env.get('RESEND_WEBHOOK_SECRET'),approved_recipient_verified:!!await recipient()});
  if(body?.action!=='dispatch')return response({code:'UNKNOWN_ACTION'},400);
  if(!apiKey)return response({code:'WORKER_KEY_MISSING'},503);
  const email=await recipient();if(!email)return response({code:'RECIPIENT_UNAVAILABLE'},409);
  const rows=await rpc('integrity_pilot_mail_lease_v1',{p_limit:3});
  let acknowledged=0;
  for(const r of rows){
   const intent={eventId:r.event_id,recipientId:r.recipient_id,createdAt:r.created_at,body:JSON.stringify({from:'Provision <updates@notify.codifiedresonance.com>',to:[email],reply_to:'drew@codifiedresonance.com',subject:r.subject,text:r.body,tags:[{name:'lane',value:'provision_staging_reservation'}]})};
   const result=await sendIntent(intent,{apiKey,allowedRecipients:new Map([[uid,email]]),readEligibility:async()=>({email:await recipient(),eligible:await rpc('integrity_pilot_mail_eligible_v1',{p_event_id:r.event_id,p_lease_token:r.lease_token}),suppressed:false})});
   await rpc('integrity_finish_delivery_v1',{p_event_id:r.event_id,p_lease_token:r.lease_token,p_outcome:result.outcome,p_provider_id:result.provider_id??null,p_error_code:result.error_code??null});acknowledged++;
  }
  return response({leased:rows.length,acknowledged});
 }catch{return response({code:'WORK_UNCONFIRMED'},503)}
});
