export class Reconciler {
  constructor(refresh,now,{visible=()=>document.visibilityState==='visible',set=(...args)=>setTimeout(...args),clear=(...args)=>clearTimeout(...args)}={}){this.refresh=refresh;this.now=now;this.visible=visible;this.set=set;this.clear=clear;this.timer=null;this.running=false;this.pending=false;this.stopped=false;}
  schedule(expiry=null){this.clear(this.timer);if(this.stopped||!this.visible())return;const delay=expiry?Math.max(1500,Math.min(60000,Date.parse(expiry)-this.now()+300)):60000;this.timer=this.set(()=>this.run(),delay);}
  hint(){if(this.stopped||!this.visible())return;this.clear(this.timer);this.timer=this.set(()=>this.run(),750);}
  async run(){if(this.stopped||!this.visible())return;if(this.running){this.pending=true;return;}this.running=true;let expiry;try{expiry=await this.refresh();}finally{this.running=false;if(this.pending){this.pending=false;this.hint();}else this.schedule(expiry);}}
  stop(){this.stopped=true;this.clear(this.timer);}
}
