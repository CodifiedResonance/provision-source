import {el,button,field,select,check,modal,closeModal,message,empty,facts} from './dom.js';
import {time,priceText,quantity,safeUrl} from './domain.js';

export function demandDialog(offer,ctx,existing=null){
  const {state,api}=ctx,g=state.generation;
  if(!state.session){ctx.authDialog();return;}
  if(!api.health?.capabilities.demand_capture){message('Private interest capture is unavailable.');return;}
  const box=el('div'),food=select('Food',[['','Choose a food'],...state.foods.map(f=>[f.id,f.name])],existing?.food_id||offer?.food_id||''),area=select('Collection area',[['','Choose an area'],...state.areas.map(a=>[a.id,`${a.label} · ${a.classification}`])],existing?.area_id||''),confirmed=check('I explicitly confirm this is my intended collection area.'),unit=select('How is this counted?',[]),qty=field('Quantity',existing?.quantity||'1'),cadence=select('How often?',['once','daily','weekly','fortnightly','monthly'],existing?.cadence||'weekly'),expiry=field('Interest expires (UTC)',existing?.expires_at?new Date(existing.expires_at).toISOString().slice(0,16):'','datetime-local');
  function units(){const f=state.foods.find(x=>x.id===food.input.value);unit.input.replaceChildren(...(f?.units||[]).map(u=>el('option',u.unit,{value:u.unit})));unit.input.value=existing?.unit||offer?.unit||f?.default_unit||'';if(!unit.input.value)unit.input.value=f?.default_unit||'';}
  units();food.input.addEventListener('change',units);
  box.append(el('p','Private interest, not an order. Test areas do not imply approved real-world coverage.'),food.label,area.label,confirmed.label,qty.label,unit.label,cadence.label,expiry.label,button(existing?'Update my interest':'Save my interest',async()=>{
    if(!ctx.guard(g))throw Error('Account changed. Reopen this form.');
    if(!confirmed.input.checked||!state.areas.some(a=>a.id===area.input.value))throw Error('Choose and confirm a returned area.');
    const f=state.foods.find(x=>x.id===food.input.value);if(!f?.units.some(u=>u.unit===unit.input.value))throw Error('Choose a permitted food and unit.');
    quantity(qty.input.value,unit.input.value);if(!expiry.input.value)throw Error('Choose an expiry.');
    const expires_at=new Date(expiry.input.value+'Z').toISOString();if(Date.parse(expires_at)<=api.now())throw Error('Choose a future expiry.');
    const payload={food_id:food.input.value,area_id:area.input.value,area_confirmed:true,quantity:qty.input.value,unit:unit.input.value,cadence:cadence.input.value,expires_at,...(existing?{demand_id:existing.id,expected_confirmed_at:existing.area_confirmed_at}:{})};
    const result=await ctx.command(existing?'integrity_update_demand_v1':'integrity_save_demand_v1',payload);
    if(result&&ctx.guard(g)){closeModal();message('Private interest acknowledged. General demand summaries remain disabled.');}
  },'primary'));modal(existing?'Update private interest':'Record private interest',box);
}

export async function interestScreen(root,ctx){
  const {state}=ctx,g=state.generation;
  root.append(el('h2','My interest'),el('p','Your current private signals, including work saved from another browser.'),button('Add private interest',()=>demandDialog(null,ctx),'primary'));
  for(const d of state.demand){const card=el('article',null,{class:'card'});card.append(el('h3',state.foods.find(f=>f.id===d.food_id)?.name||'Food no longer in the directory'),facts([['Area',state.areas.find(a=>a.id===d.area_id)?.label||d.area_id],['Quantity',`${d.quantity} ${d.unit}`],['Cadence',d.cadence],['Reconfirmed',time(d.area_confirmed_at)],['Expires',time(d.expires_at)]]),button('Update & reconfirm',()=>demandDialog(null,ctx,d)),button('Cancel interest',async()=>{if(ctx.guard(g))await ctx.command('integrity_cancel_demand_v1',{demand_id:d.id});}));root.append(card);}
  if(!state.demand.length)root.append(empty('No current private interest','Expired and cancelled signals are excluded.'));
  if(state.cursor)root.append(button('Next interest page',async()=>{const r=await ctx.api.page('integrity_my_demand_v1',{},state.cursor);if(!ctx.guard(g))return;state.demand=r.data.items;state.cursor=r.data.next_cursor;root.replaceChildren();await interestScreen(root,ctx);}));
}

export async function claimDetails(claim,ctx){
  const g=ctx.state.generation,r=await ctx.api.rpc('integrity_claim_detail_v1',{claim_id:claim.id});if(!ctx.guard(g))return;
  const d=r.data,box=el('div'),t=d.claim.terms;
  box.append(el('h3',`${d.food_name} · ${d.source_name}`),el('p',d.source_active?'Source currently active':'Source currently paused'),el('h4','Agreed hold terms'),facts([['Status',d.claim.status],['Quantity',`${t.quantity} ${t.unit}`],['Price',priceText(t.price,t.unit)],['Collection reference',d.claim.collection_reference],['Collection from',time(t.collection_start)],['Collection until',time(t.collection_end)]]),el('h4','Current Source contact details'),facts(Object.entries(d.contact).map(([k,v])=>[k.replaceAll('_',' '),v])));
  const url=safeUrl(d.contact.contact_url);if(url)box.append(el('a','Open Source website',{href:url,target:'_blank',rel:'noopener noreferrer'}));
  box.append(el('p','Contact details are current; the hold terms above are the frozen agreement. Test holds are not real collection arrangements.'));modal('Your collection',box);
}

export async function reviewScreen(root,ctx){
  const g=ctx.state.generation,lookup=field('Report reference');
  root.append(el('h2','Reports & appeals'),lookup.label,button('Open entitled report',()=>reviewDetail(lookup.input.value,ctx)));
  const list=el('div');root.append(list);
  async function load(cursor=null){
    let r;try{r=await ctx.api.page('integrity_review_queue_v1',{},cursor);}catch(e){if(ctx.guard(g)&&list.isConnected)list.replaceChildren(empty('Review queue unavailable',e.status===403?'This account is not an eligible independent reviewer. You can still open a report you are entitled to see by reference.':e.message));return;}
    if(!ctx.guard(g)||!list.isConnected)return;list.replaceChildren();
    for(const report of r.data.items){const card=el('article',null,{class:'card'});card.append(el('h3',`${report.category} · ${report.status}`),el('p',time(report.created_at)),button('Review report',()=>reviewDetail(report.id,ctx)));list.append(card);}
    if(!r.data.items.length)list.append(empty('No eligible actionable reports','Eligibility is rechecked by the server.'));
    if(r.data.next_cursor)list.append(button('Next reports',()=>load(r.data.next_cursor)));
  }await load();
}

async function reviewDetail(id,ctx){
  const g=ctx.state.generation,r=await ctx.api.rpc('integrity_review_detail_v1',{report_id:id,page:{limit:50,cursor:null}});if(!ctx.guard(g))return;
  const d=r.data,box=el('div'),history=el('div');
  box.append(facts([['Report',d.id],['Status',d.status],['Category',d.category],['Submitted reason',d.submitted_reason??'Not disclosed to this account']]),history);
  function append(decisions){for(const item of decisions)history.append(el('p',`${time(item.created_at)} · ${item.decision} · ${item.reason??'Reason not disclosed'}`));}append(d.decisions);
  let cursor=d.next_cursor;const more=button('More decision history',async()=>{const next=await ctx.api.rpc('integrity_review_detail_v1',{report_id:id,page:{limit:50,cursor}});if(!ctx.guard(g)||!box.isConnected)return;append(next.data.decisions);cursor=next.data.next_cursor;more.hidden=!cursor;});more.hidden=!cursor;box.append(more);
  const reason=field('Reason','','textarea');
  if(d.can_review){const decision=select('Decision',['request_information','upheld','dismissed']);box.append(decision.label,reason.label,button('Record review decision',async()=>{if(!ctx.guard(g)||!reason.input.value.trim())throw Error('Provide a reason in the original account.');const result=await ctx.command('integrity_review_v1',{report_id:id,decision:decision.input.value,reason:reason.input.value});if(result)closeModal();}));}
  else if(['upheld','dismissed','resolved'].includes(d.status)){box.append(reason.label,button('Submit appeal',async()=>{if(!ctx.guard(g)||!reason.input.value.trim())throw Error('Provide your appeal reason.');const result=await ctx.command('integrity_appeal_v1',{report_id:id,reason:reason.input.value});if(result)closeModal();}));}
  modal('Report detail',box);
}
