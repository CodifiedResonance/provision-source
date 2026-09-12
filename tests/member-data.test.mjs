import test from 'node:test';
import assert from 'node:assert/strict';
import {readPages,memberExport,coordinate,openingHours,changedFields} from '../staging/src/member-data.js';

const page=(items,next_cursor=null)=>({server_time:'2026-09-08T12:00:00Z',data:{items,next_cursor}});
test('complete member export traverses catalogue and all lot histories, including legacy stock',async()=>{
  const calls=[];const api={async page(name,request,cursor){calls.push([name,request,cursor]);
    if(name==='integrity_catalogue_v1')return cursor?page([{id:'old',lot_id:null}]):page([{id:'new',lot_id:'lot'}],'next');
    if(request.lot_id)return cursor?page([{event_id:'b'}]):page([{event_id:'a'}],'history-next');
    return page([{event_id:'legacy'}]);
  }};
  const data=await memberExport(api,'source',()=>true);
  assert.equal(data.catalogue.items.length,2);assert.equal(data.histories[0].items.length,2);
  assert.equal(calls.length,5);assert.equal(calls.at(-1)[1].legacy_offer_id,'old');
  assert.equal(calls.at(-1)[1].lot_id,null);assert.match(data.catalogue.consistency,/not a point-in-time/);
});
test('member pagination aborts on account changes, cursor loops and incomplete budget',async()=>{
  let current=true,calls=0;
  await assert.rejects(readPages({async page(){calls++;current=false;return page([{id:'private'}]);}},'read',{}, {guard:()=>current}),/Account or Source/);
  assert.equal(calls,1);
  await assert.rejects(readPages({page:async()=>page([{id:'a'}],'same')},'read',{}),/did not advance/);
  await assert.rejects(readPages({page:async()=>page([{id:'a'}],'next')},'read',{}, {maxPages:1}),/No complete export/);
});
test('unknown coordinates and opening days remain distinct from zero and closed',()=>{
  assert.equal(coordinate('',90),null);assert.equal(coordinate('0',90),0);assert.equal(coordinate('-1.2',180),-1.2);
  for(const value of ['NaN','0x20','91'])assert.throws(()=>coordinate(value,90));
  const hours=openingHours('Europe/London',{monday:'09:00-12:00, 13:00-17:00',tuesday:'closed',wednesday:'',thursday:'22:00-02:00'});
  assert.equal(hours.monday.length,2);assert.deepEqual(hours.tuesday,[]);assert.equal('wednesday' in hours,false);
  assert.deepEqual(hours.thursday,[{open:'22:00',close:'02:00'}]);
  assert.throws(()=>openingHours('invented/zone',{}));assert.throws(()=>openingHours('UTC',{monday:'25:00-26:00'}));
});
test('profile patches preserve untouched fields and explicitly clear supplied fields',()=>{
  const p={name:'Farm',latitude:0,longitude:-1,opening_hours:{timezone:'UTC'},logo_path:null};
  assert.deepEqual(changedFields(p,{name:'Farm',latitude:null,longitude:-1,opening_hours:{timezone:'UTC'},logo_path:null}),{latitude:null});
  assert.deepEqual(p.opening_hours,{timezone:'UTC'});assert.equal(p.latitude,0);
});
