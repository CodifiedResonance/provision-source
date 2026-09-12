export const $=s=>document.querySelector(s);
export function el(tag,text,attrs={}){const n=document.createElement(tag);if(text!==null&&text!==undefined)n.textContent=String(text);for(const [k,v]of Object.entries(attrs))if(v!==null&&v!==undefined)n.setAttribute(k,String(v));return n;}
export function button(text,action,kind=''){const b=el('button',text,{type:'button',class:kind});b.addEventListener('click',async()=>{b.disabled=true;if(b.nextElementSibling?.classList.contains('action-error'))b.nextElementSibling.remove();try{await action(b);}catch(e){actionError(b,e.message);}finally{b.disabled=false;}});return b;}
export function actionError(action,text){
  const dialog=$('#dialog');
  if(dialog?.open){const host=action?.isConnected&&dialog.contains(action)?action:$('#dialogBody');let n=host.nextElementSibling;
    if(!n?.classList.contains('action-error')){n=el('p',null,{class:'error action-error',role:'alert',tabindex:'-1'});host===action?host.after(n):host.append(n);}
    n.textContent=text;n.focus();return;
  }
  message(text,true);
}
export function fieldError(field,text){
  let n=field.label.querySelector('.field-error');if(!n){n=el('p',null,{class:'error field-error',role:'alert',id:'error-'+crypto.randomUUID()});field.label.append(n);}
  n.textContent=text;field.input.addEventListener('input',()=>{n.remove();field.input.removeAttribute('aria-invalid');field.input.removeAttribute('aria-describedby');},{once:true});field.input.setAttribute('aria-invalid','true');field.input.setAttribute('aria-describedby',n.id);field.input.focus();throw Error(text);
}
export function message(text,error=false){const n=$('#message');n.hidden=!text;n.textContent=text;n.classList.toggle('error',error);}
export function field(name,value='',type='text'){const label=el('label',name),input=el(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.value=value??'';label.append(input);return {label,input};}
export function select(name,options,value){const label=el('label',name),input=el('select');for(const option of options){const [v,text]=Array.isArray(option)?option:[option,option];input.append(el('option',text,{value:v}));}if(value!==undefined)input.value=value;label.append(input);return {label,input};}
export function check(name,value=false){const label=el('label',null,{class:'check'}),input=el('input',null,{type:'checkbox'});input.checked=value;label.append(input,el('span',name));return {label,input};}
let returnFocus=null,cleanup=()=>{};
export function modal(title,content,onClose=()=>{}){cleanup();cleanup=onClose;returnFocus=document.activeElement;$('#dialogTitle').textContent=title;$('#dialogBody').replaceChildren(content);if(!$('#dialog').open)$('#dialog').showModal();}
export function closeModal(){$('#dialog').close();}
export function initDialog(){$('#closeDialog').addEventListener('click',closeModal);$('#dialog').addEventListener('close',()=>{cleanup();cleanup=()=>{};$('#dialogBody').replaceChildren();returnFocus?.focus();});}
export function empty(title,detail){const n=el('div',null,{class:'empty'});n.append(el('h2',title),el('p',detail,{class:'muted'}));return n;}
export function facts(entries){const d=el('dl');for(const [k,v]of entries)d.append(el('dt',k),el('dd',v??'Unknown'));return d;}
