// Member reads are fresh transactions, never a consistent backup or inventory engine.
export async function readPages(api,name,request,{guard=()=>true,key='id',maxPages=1000}={}){
  let cursor=null,first=null,last=null,pages=0;const items=new Map(),seen=new Set();
  do{
    if(!guard())throw Error('Account or Source changed. Restart this read.');
    if(pages>=maxPages)throw Error('Read limit reached. No complete export was produced.');
    const r=await api.page(name,request,cursor);
    if(!guard())throw Error('Account or Source changed. No private result was retained.');
    first??=r.server_time;last=r.server_time;pages++;
    for(const item of r.data.items){if(!item[key])throw Error('Record identity missing.');items.set(item[key],item);}
    cursor=r.data.next_cursor;
    if(cursor!==null){if(seen.has(cursor))throw Error('Pagination did not advance. Refresh before trying again.');seen.add(cursor);}
  }while(cursor!==null);
  return {items:[...items.values()],pages,started_at:first,completed_at:last,consistency:'Fresh transactions per page; not a point-in-time snapshot'};
}
export async function memberExport(api,sourceId,guard){
  const catalogue=await readPages(api,'integrity_catalogue_v1',{source_id:sourceId},{guard});
  const histories=[];
  for(const offer of catalogue.items){
    const history=await readPages(api,'integrity_lot_history_v1',{source_id:sourceId,lot_id:offer.lot_id,legacy_offer_id:offer.lot_id?null:offer.id},{guard,key:'event_id'});
    histories.push({offer_id:offer.id,lot_id:offer.lot_id,...history});
  }
  if(!guard())throw Error('Account or Source changed. Export cancelled.');
  return {catalogue,histories};
}
export function coordinate(value,limit){
  if(!value.trim())return null;
  if(!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))throw Error('Enter a decimal coordinate or leave it unknown.');
  const n=Number(value);if(!Number.isFinite(n)||Math.abs(n)>limit)throw Error('Coordinate is outside its permitted range.');return n;
}
export const DAYS=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
export function openingHours(timezone,days){
  if(!timezone.trim())throw Error('Provide the opening-hours time zone.');
  try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{throw Error('Use a recognised time zone, such as Europe/London.');}
  const out={timezone};
  for(const day of DAYS){const text=days[day]?.trim()||'';if(!text)continue;if(text.toLowerCase()==='closed'){out[day]=[];continue;}
    out[day]=text.split(',').map(part=>{const m=part.trim().match(/^([0-2]\d:[0-5]\d)\s*-\s*([0-2]\d:[0-5]\d)$/);if(!m||m[1]>='24:00'||m[2]>='24:00')throw Error('Use HH:MM-HH:MM, separated by commas, or closed.');return {open:m[1],close:m[2]};});
  }return out;
}
export function changedFields(original,edited){return Object.fromEntries(Object.entries(edited).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(original[key])));}
