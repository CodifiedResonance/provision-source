// Staging-only evidence gateway. Never logs credentials, paths, signed URLs or file bytes.
import { ImageMagick, initializeImageMagick, MagickFormat, ResourceLimits } from 'npm:@imagemagick/magick-wasm@0.0.43';
const URL_ROOT = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
if (URL_ROOT !== 'https://qaaskvbhssonbktdjdki.supabase.co') throw new Error('STAGING_TARGET_REQUIRED');
const PUBLIC_KEY = 'sb_publishable_G-7Q6e-hOZhCBCC_IAdalA_82nbYVjB';
const MAX = 10485760;
const BODY_DEADLINE_MS = 30000;
const UPLOAD_WRITE_DEADLINE_MS = 90000;
const BUCKET = 'provision-evidence';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CORS = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-source-id','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
let ready: Promise<void> | undefined;
const wasmReady = () => ready ??= (async () => {
  const bytes = await Deno.readFile(new URL(import.meta.resolve('npm:@imagemagick/magick-wasm@0.0.43/magick.wasm')));
  await initializeImageMagick(bytes);
  ResourceLimits.memory=67108864n;ResourceLimits.maxMemoryRequest=134217728n;ResourceLimits.disk=0n;ResourceLimits.width=20000n;ResourceLimits.height=20000n;ResourceLimits.area=20000000n;ResourceLimits.listLength=16n;ResourceLimits.time=2n;
})();
class SafeError extends Error { constructor(public code: string,public status=400){super(code);} }
const digest = async (b:Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');
const adminHeaders = () => ({apikey:SERVICE,Authorization:'Bearer '+SERVICE});
async function rpc(name:string,args:Record<string,unknown>) {
 const r = await fetch(URL_ROOT+'/rest/v1/rpc/'+name,{method:'POST',headers:{...adminHeaders(),'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(15000)});
 if (!r.ok) {const b=await r.json().catch(()=>({}));const code=/^[A-Z_]+$/.test(b.message??'')?b.message:'DATABASE_UNAVAILABLE';throw new SafeError(code,r.status===403?404:409);}
 return r.status===204?null:await r.json();
}
async function actor(req:Request,required:boolean):Promise<string|null> {
 const h=req.headers.get('authorization');if(!h){if(required)throw new SafeError('AUTH_REQUIRED',401);return null;}
 const r=await fetch(URL_ROOT+'/auth/v1/user',{headers:{apikey:PUBLIC_KEY,Authorization:h},signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw new SafeError('AUTH_REQUIRED',401);
 const u=await r.json();if(!UUID.test(u.id??''))throw new SafeError('AUTH_REQUIRED',401);return u.id;
}
function pathURL(path:string) {return URL_ROOT+'/storage/v1/object/'+BUCKET+'/'+path.split('/').map(encodeURIComponent).join('/');}
async function storeOnce(path:string,b:Uint8Array,mime:string) {
 const r=await fetch(pathURL(path),{method:'POST',headers:{...adminHeaders(),'Content-Type':mime,'x-upsert':'false','cache-control':'no-store'},body:b,signal:AbortSignal.timeout(20000)});
 if(r.ok)return;
 // A lost response or concurrent retry may have committed. Never overwrite it.
 const previous=await fetch(pathURL(path),{headers:adminHeaders(),signal:AbortSignal.timeout(15000)});
 if(!previous.ok)throw new SafeError('STORAGE_UNAVAILABLE',503);
 const old=new Uint8Array(await previous.arrayBuffer());
 if(old.length!==b.length||await digest(old)!==await digest(b))throw new SafeError('OBJECT_CONFLICT',409);
}
async function readBounded(req:Request):Promise<Uint8Array> {
 const declared=Number(req.headers.get('content-length'));
 if(declared>MAX)throw new SafeError('FILE_TOO_LARGE',413);
 if(!req.body)throw new SafeError('EMPTY_FILE');
 const reader=req.body.getReader();const chunks:Uint8Array[]=[];let n=0;
 let timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new SafeError('UPLOAD_TIMEOUT',408));void reader.cancel().catch(()=>{});},BODY_DEADLINE_MS);});
 try{for(;;){const {done,value}=await Promise.race([reader.read(),deadline]);if(done)break;n+=value.length;if(n>MAX){void reader.cancel().catch(()=>{});throw new SafeError('FILE_TOO_LARGE',413);}chunks.push(value);}}finally{clearTimeout(timer);}
 if(n===0)throw new SafeError('EMPTY_FILE');const bytes=new Uint8Array(n);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}return bytes;
}
function detected(b:Uint8Array):string {
 if(b.length>=24 && b[0]===137 && new TextDecoder().decode(b.slice(1,8))==='PNG\r\n\x1a\n')return 'image/png';
 if(b.length>=4 && b[0]===255 && b[1]===216 && b[2]===255)return 'image/jpeg';
 if(b.length>=12 && new TextDecoder().decode(b.slice(0,4))==='RIFF' && new TextDecoder().decode(b.slice(8,12))==='WEBP')return 'image/webp';
 if(b.length>=8 && new TextDecoder().decode(b.slice(0,5))==='%PDF-')return 'application/pdf';
 throw new SafeError('CONTENT_TYPE_MISMATCH',422);
}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
 try{
  const started=Date.now();
  const u=new URL(req.url);const m=u.pathname.match(/\/(upload|download)\/([0-9a-f-]+)$/i);
  if(!m||!UUID.test(m[2]))throw new SafeError('NOT_FOUND',404);
  const mode=m[1];const eid=m[2];if((mode==='upload'&&req.method!=='POST')||(mode==='download'&&req.method!=='GET'))throw new SafeError('METHOD_NOT_ALLOWED',405);
  const who=await actor(req,mode==='upload');const sid=req.headers.get('x-source-id');
  if(mode==='upload'&&(!sid||!UUID.test(sid)))throw new SafeError('SOURCE_REQUIRED');
  const args={p_source_id:mode==='upload'?sid:null,p_attachment_id:eid,p_actor:who,p_mode:mode};
  const c=await rpc('integrity_evidence_worker_context_v1',args);
  if(mode==='download'){
   const r=await fetch(pathURL(c.validated_path),{headers:adminHeaders(),signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw new SafeError('STORAGE_UNAVAILABLE',503);
   const b=new Uint8Array(await r.arrayBuffer());if(await digest(b)!==c.validated_checksum)throw new SafeError('CHECKSUM_MISMATCH',503);
   // Recheck withdrawal/member revocation after fetching, before responding.
   await rpc('integrity_evidence_worker_context_v1',args);
   return new Response(b,{headers:{...CORS,'Content-Type':'image/png','Content-Disposition':'inline; filename="evidence.png"','Content-Security-Policy':"default-src 'none'; sandbox"}});
  }
  const b=await readBounded(req);const checksum=await digest(b);
  if(b.length!==c.bytes||checksum!==c.checksum)throw new SafeError('CHECKSUM_MISMATCH',422);
  const mime=detected(b);if(mime!==c.media_type)throw new SafeError('CONTENT_TYPE_MISMATCH',422);
  let clean:Uint8Array|null=null;let quarantine=mime==='application/pdf'?'PDF_REVIEW_REQUIRED':null;
  if(!quarantine){
   await wasmReady();
   try{
    clean=ImageMagick.read(b,mime==='image/png'?MagickFormat.Png:mime==='image/jpeg'?MagickFormat.Jpeg:MagickFormat.WebP,(img)=>{
     if(img.width*img.height>20000000)throw new SafeError('IMAGE_RESOURCE_REVIEW_REQUIRED',422);
     img.strip();
     img.settings.setDefine(MagickFormat.Png,'exclude-chunks','all');
     return img.write(MagickFormat.Png,bytes=>Uint8Array.from(bytes));
    });
    if(clean.length>MAX){clean=null;quarantine='IMAGE_RESOURCE_REVIEW_REQUIRED';}
   }catch(e){if(e instanceof SafeError){quarantine=e.code;}else if(/resource|memory|cache|limit/i.test(String(e))){quarantine='IMAGE_RESOURCE_REVIEW_REQUIRED';}else throw new SafeError('INVALID_IMAGE',422);}
  }
  // Permission can change while receiving/decoding the body. Never reuse that
  // initial authorization to begin a later Storage write.
  const refreshWritePermission=async()=>{if(Date.now()-started>=UPLOAD_WRITE_DEADLINE_MS)throw new SafeError('UPLOAD_TIMEOUT',408);await rpc('integrity_evidence_worker_context_v1',args);if(Date.now()-started>=UPLOAD_WRITE_DEADLINE_MS)throw new SafeError('UPLOAD_TIMEOUT',408);};
  await refreshWritePermission();
  await storeOnce(c.original_path,b,mime);
  let cleanHash:string|null=null;
  if(clean){cleanHash=await digest(clean);await refreshWritePermission();await storeOnce(c.source_id+'/'+c.event_id+'/'+eid+'/validated.png',clean,'image/png');}
  await rpc('integrity_record_evidence_validation_v1',{p_source_id:c.source_id,p_attachment_id:eid,p_actor:who,p_result:{state:clean?'validated':'quarantined',original_checksum:checksum,original_bytes:b.length,validated_checksum:cleanHash,validated_bytes:clean?.length??null,reason_code:quarantine}});
  return Response.json({attachment_id:eid,status:clean?'uploaded':'quarantined',next_action:'finalize',validator_version:'magick-wasm-0.0.43-integrity-1'},{headers:CORS});
 }catch(e){const known=e instanceof SafeError;return Response.json({code:known?e.code:'VALIDATION_UNAVAILABLE',retryable:!known||e.status>=500||e.status===408},{status:known?e.status:503,headers:CORS});}
});
