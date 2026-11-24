// Staging maintenance: service-authenticated, bounded, fixed manifests only.
// No mail/provider dispatch. No client-supplied object paths or account IDs.
const ROOT=Deno.env.get('SUPABASE_URL')!,SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
if(ROOT!=='https://qaaskvbhssonbktdjdki.supabase.co')throw Error('STAGING_REQUIRED');
const H={apikey:SERVICE,Authorization:'Bearer '+SERVICE};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
class Safe extends Error{}
const need=(v:unknown,c:string)=>{if(!v)throw new Safe(c);};
const safe=(e:unknown)=>e instanceof Safe&&/^[A-Z_]+$/.test(e.message)?e.message:'MAINTENANCE_UNAVAILABLE';
async function http(path:string,init:RequestInit={}){return await fetch(ROOT+path,{...init,signal:AbortSignal.timeout(4000)});}
async function rpc(name:string,body:any){
 const r=await http('/rest/v1/rpc/'+name,{method:'POST',headers:{...H,'Content-Type':'application/json'},body:JSON.stringify(body)});const b=r.status===204?null:await r.json().catch(()=>null);
 if(!r.ok)throw new Safe(/^[A-Z_]+$/.test(b?.message||'')?b.message:'DATABASE_UNAVAILABLE');return b;
}
function pathOK(path:string){const p=path.split('/');return p.length===4&&p.slice(0,3).every(x=>uuid.test(x))&&['original','validated.png'].includes(p[3]);}
async function erase(paths:string[]){
 need(paths.length<=100&&paths.every(pathOK)&&new Set(paths).size===paths.length,'MANIFEST_INVALID');
 if(!paths.length)return;
 const r=await http('/storage/v1/object/provision-evidence',{method:'DELETE',headers:{...H,'Content-Type':'application/json'},body:JSON.stringify({prefixes:paths})});need(r.ok,'STORAGE_DELETE_FAILED');
 for(const path of paths){
  const absent=await http('/storage/v1/object/provision-evidence/'+path,{headers:H});
  need(!absent.ok,'STORAGE_ABSENCE_UNCONFIRMED');const b=await absent.json().catch(()=>({}));need(!absent.ok&&(absent.status===404||b.statusCode==='404'||b.error==='not_found'),'STORAGE_ABSENCE_UNCONFIRMED');
 }
}
async function authExists(uid:string){need(uuid.test(uid),'MANIFEST_INVALID');const r=await http('/auth/v1/admin/users/'+uid,{headers:H});if(r.status===404)return false;need(r.ok,'AUTH_LOOKUP_FAILED');return true;}
Deno.serve(async req=>{
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 if(req.method!=='POST')return Response.json({code:'METHOD_NOT_ALLOWED'},{status:405,headers});
 if(req.headers.get('authorization')!=='Bearer '+SERVICE)return Response.json({code:'FORBIDDEN'},{status:403,headers});
 const run=crypto.randomUUID(),counts={cleaned:0,closed:0,failed:0,skipped:0};const started=Date.now();
 try{
  need((await req.text()).trim()==='{}','EMPTY_REQUEST_REQUIRED');
  await rpc('integrity_maintenance_event_v1',{p_run_id:run,p_event:'started',p_counts:{}});
  const cleanup=await rpc('integrity_lease_evidence_cleanup_v1',{p_limit:1});
  for(const job of cleanup){
   try{
    need(job.bucket==='provision-evidence'&&uuid.test(job.attachment_id)&&uuid.test(job.source_id)&&job.paths.length===2&&job.paths.every((p:string)=>p.startsWith(job.source_id+'/')&&p.split('/')[2]===job.attachment_id),'MANIFEST_INVALID');
    await erase(job.paths);
    await rpc('integrity_finish_evidence_cleanup_v1',{p_attachment_id:job.attachment_id,p_lease_token:job.lease_token,p_deleted:true,p_error_code:null});counts.cleaned++;
   }catch(e){counts.failed++;await rpc('integrity_finish_evidence_cleanup_v1',{p_attachment_id:job.attachment_id,p_lease_token:job.lease_token,p_deleted:false,p_error_code:safe(e)}).catch(()=>{});}
  }
  const closures=await rpc('integrity_closure_work_items_v1',{p_limit:1});
  for(const item of closures){
   if(Date.now()-started>65000){counts.skipped++;continue;}
   try{
    if(!item.prepared)need(await authExists(item.principal),'AUTH_ACCOUNT_MISSING');
    const c=await rpc('integrity_prepare_account_closure_v1',{p_principal:item.principal,p_request_id:item.request_id,p_policy_reference:item.policy_reference});
    if(Date.parse(c.not_before)>Date.now()){counts.skipped++;continue;}
    need(c.principal===item.principal&&c.request_id===item.request_id&&c.objects.every((o:any)=>o.bucket==='provision-evidence'),'MANIFEST_INVALID');
    if(!c.bytes_deleted_at){
     const pending=await rpc('integrity_erasure_pending_v1',{p_request_id:item.request_id,p_limit:4});
     need(pending.every((o:any)=>o.bucket==='provision-evidence'),'MANIFEST_INVALID');
     await erase(pending.map((o:any)=>o.path));
     await rpc('integrity_confirm_erasure_objects_v1',{p_request_id:item.request_id,p_paths:pending.map((o:any)=>o.path)});
     if((await rpc('integrity_erasure_pending_v1',{p_request_id:item.request_id,p_limit:1})).length){counts.skipped++;continue;}
     await rpc('integrity_finish_account_closure_v1',{p_request_id:item.request_id,p_phase:'bytes_deleted'});
    }
    if(await authExists(item.principal)){
     const d=await http('/auth/v1/admin/users/'+item.principal,{method:'DELETE',headers:{...H,'Content-Type':'application/json'},body:JSON.stringify({should_soft_delete:false})});
     if(!d.ok&&d.status!==404)throw new Safe('AUTH_DELETE_FAILED');
    }
    need(!await authExists(item.principal),'AUTH_ABSENCE_UNCONFIRMED');
    await rpc('integrity_finish_account_closure_v1',{p_request_id:item.request_id,p_phase:'auth_deleted'});
    await rpc('integrity_closure_processing_result_v1',{p_request_id:item.request_id,p_error_code:null});counts.closed++;
   }catch(e){counts.failed++;await rpc('integrity_closure_processing_result_v1',{p_request_id:item.request_id,p_error_code:safe(e)}).catch(()=>{});}
  }
  await rpc('integrity_maintenance_event_v1',{p_run_id:run,p_event:'completed',p_counts:counts});
  return Response.json({run_id:run,...counts},{headers});
 }catch(e){await rpc('integrity_maintenance_event_v1',{p_run_id:run,p_event:'failed',p_counts:counts}).catch(()=>{});return Response.json({code:safe(e),run_id:run},{status:503,headers});}
});
