import {el,button,field,select,check,modal,closeModal,message} from './dom.js';
import {coordinate,openingHours,changedFields,DAYS} from './member-data.js';

export function profileForm(p,ctx){
  const g=ctx.state.generation,box=el('div'),fields={};
  for(const [key,name]of [['name','Business name'],['legal_name','Legal name'],['description','Description'],['public_email','Public email'],['public_phone','Public phone'],['contact_url','Website'],['address_line','Address'],['locality','Locality'],['postcode','Postcode'],['collection_notes','Collection instructions'],['logo_path','Existing logo reference'],['latitude','Latitude'],['longitude','Longitude']]){
    fields[key]=field(name,p[key]??'');box.append(fields[key].label);
  }
  const hours=el('details'),known=check('Opening hours supplied',p.opening_hours!==null),timezone=field('Opening-hours time zone',p.opening_hours?.timezone||''),dayFields={};
  hours.append(el('summary','Opening hours'),known.label,timezone.label,el('p','For each day: 09:00-12:00, 13:00-17:00. Use closed for a confirmed closed day; leave blank when unknown. Overnight periods retain their stated times.'));
  for(const day of DAYS){const spans=p.opening_hours?.[day],f=field(day,spans?(spans.length?spans.map(s=>`${s.open}-${s.close}`).join(', '):'closed'):'');dayFields[day]=f;hours.append(f.label);}
  box.append(hours,el('p','Blank location coordinates mean unknown. Changing location suspends any approved demand-summary access pending review. A logo reference does not upload a new logo.'));
  box.append(button('Save profile',async()=>{
    if(!ctx.guard(g))throw Error('Account or Source changed. Reopen the profile.');
    const edited=Object.fromEntries(Object.entries(fields).map(([k,f])=>[k,f.input.value||null]));
    edited.latitude=coordinate(fields.latitude.input.value,90);edited.longitude=coordinate(fields.longitude.input.value,180);
    edited.opening_hours=known.input.checked?openingHours(timezone.input.value,Object.fromEntries(DAYS.map(day=>[day,dayFields[day].input.value]))):null;
    const patch=changedFields(p,edited);if(!Object.keys(patch).length){message('No profile changes to save.');return;}
    const result=await ctx.command('integrity_update_profile_v1',{source_id:p.source_id,expected_revision:p.revision,patch},p.source_id);
    if(result&&ctx.guard(g))closeModal();
  },'primary'),button(p.active?'Pause Source':'Reactivate Source',async()=>{
    if(!ctx.guard(g))throw Error('Account or Source changed.');
    const result=await ctx.command('integrity_set_active_v1',{source_id:p.source_id,expected_revision:p.revision,active:!p.active},p.source_id);
    if(result&&ctx.guard(g))closeModal();
  }));modal('Source profile',box);
}

export function physicalDatesForm(o,ctx){
  if(!o.lot_id){message('Legacy stock needs reviewed lot activation before physical-date correction.');return;}
  const g=ctx.state.generation,box=el('div'),original=o.physical_dates,inputs={};
  box.append(el('p','Correct this same batch with a reason. Earlier assertions remain in its history. This does not reconfirm availability or create a new batch.'));
  for(const [key,name]of [['harvested_at','Harvested'],['landed_at','Landed'],['baked_at','Baked'],['packed_at','Packed']]){
    const f=field(name+' (UTC)',original[key]?new Date(original[key]).toISOString().replace(/Z$/,''):'','datetime-local');f.input.step='0.001';inputs[key]=f;box.append(f.label);
  }
  const type=select('Printed date type',[['','Unknown'],['use_by','Use by'],['best_before','Best before']],original.date_type||''),date=field('Printed date',original.date_value||'','date'),zone=field('Printed-date time zone',original.date_timezone||''),handling=field('Handling',original.handling||'','textarea'),allergens=field('Allergen information',original.allergen_information||'','textarea'),reason=field('Reason for this correction','','textarea');
  box.append(type.label,date.label,zone.label,handling.label,allergens.label,reason.label,button('Record correction',async()=>{
    if(!ctx.guard(g))throw Error('Account or Source changed. Reopen this batch.');
    if(!reason.input.value.trim())throw Error('Provide a correction reason.');
    const physical_dates={...original,date_type:type.input.value||null,date_value:date.input.value||null,date_timezone:zone.input.value||null,handling:handling.input.value||null,allergen_information:allergens.input.value||null};
    for(const [key,f]of Object.entries(inputs)){
      const initial=original[key]?new Date(original[key]).toISOString().replace(/Z$/,''):'';
      // Browsers may normalise datetime strings; preserve the original instant when equivalent.
      const value=f.input.value?new Date(f.input.value+'Z').toISOString():null;
      physical_dates[key]=value&&initial&&Date.parse(value)===Date.parse(original[key])?original[key]:value;
    }
    const result=await ctx.command('integrity_correct_physical_dates_v1',{source_id:o.source_id,lot_id:o.lot_id,expected_revision:o.revision,physical_dates,reason:reason.input.value},o.source_id);
    if(result&&ctx.guard(g))closeModal();
  },'primary'));modal('Correct physical dates',box);
}
