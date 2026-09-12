import {button,el,modal,message} from './dom.js';
export async function installLifecycle({busy}){
  let prompt=null,registration=null;
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();prompt=event;});
  document.querySelector('#install').addEventListener('click',async()=>{
    if(prompt){await prompt.prompt();await prompt.userChoice;prompt=null;return;}
    const box=el('div');box.append(el('p','On Android Chrome, open the browser menu and choose Install app when available. On iPhone Safari, choose Share, then Add to Home Screen. A native prompt is available only when your browser offers one.'),el('p','This is a separate staging installation. Your live app and its private work do not move here automatically.'));modal('Install help',box);
  });
  if(!('serviceWorker'in navigator)||import.meta.env.DEV)return;
  try{
    registration=await navigator.serviceWorker.register('./service-worker.js',{scope:'./'});
    const notify=()=>{if(registration.waiting)document.querySelector('#update').hidden=false;};notify();
    registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',notify));
    document.querySelector('#update').addEventListener('click',()=>{
      const box=el('div');box.append(el('p','Finish your current send and save your draft first. The update reloads this preview; it does not clear saved drafts.'),button('Apply update and reload',()=>{if(busy())throw Error('A send is still in progress. Wait before updating.');if(!registration.waiting)throw Error('No waiting update.');navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});registration.waiting.postMessage({type:'APPLY_UPDATE'});}));modal('Update available',box);
    });
  }catch{message('Installation support could not be registered. The browser page is still usable.');}
}
