import validators from './validators.cjs';
import operations from './operations.json' with {type:'json'};
export class ApiError extends Error{constructor(code,status=0){super(code);this.code=code;this.status=status;}}
export class IntegrityApi {
  constructor(config,{fetcher=fetch,session=()=>null,clock=()=>Date.now()}={}){
    if(config.url!=='https://qaaskvbhssonbktdjdki.supabase.co')throw new ApiError('STAGING_ONLY');
    this.config=config;this.fetcher=fetcher;this.session=session;this.clock=clock;this.health=null;this.offset=0;this.lastSynced=null;this.incompatible=false;
  }
  validate(name,side,payload){const v=validators[name+'_'+side];if(!v||!v(payload))throw new ApiError(side==='response'?'UPDATE_REQUIRED':'INVALID_REQUEST');}
  async rpc(name,request){
    const op=operations[name];if(!op)throw new ApiError('UNDOCUMENTED_OPERATION');
    this.validate(name,'request',request);
    if(!this.config.publishableKey)throw new ApiError('STAGING_SETUP_REQUIRED');
    if(this.incompatible)throw new ApiError('UPDATE_REQUIRED');
    const session=this.session();
    if(op.auth!=='public'&&!session)throw new ApiError('AUTH_REQUIRED',403);
    if(op.mutation&&this.health?.write_mode!=='enabled')throw new ApiError('READ_ONLY');
    const capability=op.mutation?(name.includes('_claim_')?'claims':name.includes('_evidence_')?'evidence_upload':name==='integrity_save_demand_v1'?'demand_capture':null):null;
    if(capability&&!this.health?.capabilities[capability])throw new ApiError('CAPABILITY_DISABLED');
    const start=this.clock();let response;
    try{response=await this.fetcher(this.config.url+'/rest/v1/rpc/'+name,{method:'POST',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(20000),headers:{apikey:this.config.publishableKey,'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.access_token}:{})},body:JSON.stringify({p_request:request})});}
    catch{throw new ApiError('CONNECTION_UNCONFIRMED');}
    let result;try{result=await response.json();}catch{throw new ApiError('INVALID_SERVER_RESPONSE',response.status);}
    if(!response.ok)throw new ApiError(typeof result.message==='string'?result.message:'REQUEST_FAILED',response.status);
    try{this.validate(name,'response',result);}catch(e){this.incompatible=true;this.health=null;throw e;}
    // Mutations/replays carry original timestamps. Only fresh reads set the clock.
    if(!op.mutation){this.offset=Date.parse(result.server_time)-(start+this.clock())/2;this.lastSynced=result.server_time;}
    if(name==='integrity_health_v1'){
      if(result.data.contract_version!==this.config.contractVersion){this.incompatible=true;throw new ApiError('UPDATE_REQUIRED');}
      this.health=result.data;
    }
    return result;
  }
  now(){return this.clock()+this.offset;}
  async page(name,request,cursor=null){return this.rpc(name,{...request,page:{limit:50,cursor}});}
  async evidence(id){
    if(!/^[0-9a-f-]{36}$/i.test(id))throw new ApiError('INVALID_ATTACHMENT');
    const s=this.session(),r=await this.fetcher(`${this.config.url}/functions/v1/integrity-evidence/download/${id}`,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(20000),headers:{apikey:this.config.publishableKey,...(s?{Authorization:'Bearer '+s.access_token}:{})}});
    if(!r.ok)throw new ApiError('EVIDENCE_UNAVAILABLE',r.status);
    if(r.headers.get('content-type')?.split(';')[0]!=='image/png')throw new ApiError('UNSUPPORTED_EVIDENCE');
    return r.blob();
  }
}
