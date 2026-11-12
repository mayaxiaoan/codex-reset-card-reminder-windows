import {readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {atomicWrite} from './store.mjs';

const defaults=()=>({version:1,enabled:false,handledProcessKeys:[],lastAttempt:null});
export class StartupDebug {
  constructor(directory,presence,notify,now=Date.now){
    this.directory=join(directory,'Debug');this.path=join(this.directory,'startup-notification.json');
    this.presence=presence;this.notify=notify;this.now=now;this.queue=Promise.resolve();
    this.disabledRequested=false;this.disableGeneration=0;this.stopped=false;
  }
  serial(operation){const task=this.queue.then(operation);this.queue=task.catch(()=>{});return task;}
  async load(){
    if(this.state)return;
    try{this.state=JSON.parse(await readFile(this.path,'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw error;this.state=defaults();}
    const s=this.state;
    if(s.version!==1||typeof s.enabled!=='boolean'||!Array.isArray(s.handledProcessKeys)||
      s.handledProcessKeys.length>64||s.handledProcessKeys.some(key=>typeof key!=='string'||!key)||
      (s.lastAttempt!==null&&(!s.lastAttempt||typeof s.lastAttempt!=='object'||
        !['attempting','accepted','failed','cancelled'].includes(s.lastAttempt.status)||
        !Number.isFinite(s.lastAttempt.attemptedAt)))){
      this.state=null;throw new Error('Debug 启动通知设置损坏，测试未执行。');
    }
  }
  async save(state){await mkdir(this.directory,{recursive:true});await atomicWrite(this.path,state);this.state=state;}
  view(){const last=this.state.lastAttempt;return{enabled:this.state.enabled,lastAttempt:last?{
    status:last.status,attemptedAt:last.attemptedAt,acceptedAt:last.acceptedAt??null,error:last.error??null,
  }:null};}
  status(){return this.serial(async()=>{await this.load();return this.view();});}
  setEnabled(enabled){
    if(typeof enabled!=='boolean')return Promise.reject(new Error('启动通知测试开关必须为布尔值'));
    if(!enabled){this.disabledRequested=true;this.disableGeneration++;}
    const generation=this.disableGeneration;
    return this.serial(async()=>{
      await this.load();
      if(enabled===this.state.enabled){if(enabled&&generation===this.disableGeneration)this.disabledRequested=false;return this.view();}
      const next=structuredClone(this.state);
      if(enabled){
        const current=await this.presence(true);
        if(current.active!==true||!current.processKey)throw new Error('无法确认当前 Codex 启动身份，请稍后再开启测试。');
        // Enabling never sends in this launch, including disable/re-enable in the same process.
        next.handledProcessKeys=[...next.handledProcessKeys.filter(key=>key!==current.processKey),current.processKey].slice(-64);
      }
      next.enabled=enabled;await this.save(next);
      if(!enabled||generation===this.disableGeneration)this.disabledRequested=!enabled;
      return this.view();
    });
  }
  tick(){return this.serial(()=>this.runTick());}
  stop(){this.stopped=true;}
  delay(){return this.state?.enabled?5000:60000;}
  async runTick(){
    await this.load();
    if(!this.state.enabled||this.disabledRequested||this.stopped)return;
    const current=await this.presence();
    if(current.active!==true||!current.processKey||this.state.handledProcessKeys.includes(current.processKey)||
      this.disabledRequested||this.stopped)return;
    const claimed=structuredClone(this.state);
    claimed.handledProcessKeys=[...claimed.handledProcessKeys,current.processKey].slice(-64);
    claimed.lastAttempt={status:'attempting',attemptedAt:this.now(),acceptedAt:null,error:null};
    // Persist before Windows submission; a lost reply or worker restart cannot send twice.
    await this.save(claimed);
    if(this.disabledRequested||this.stopped){
      const cancelled=structuredClone(this.state);cancelled.lastAttempt.status='cancelled';await this.save(cancelled);return;
    }
    try{
      const result=await this.notify({id:'startup-debug:'+current.processKey,
        title:'重置卡防过期提醒 · Codex 启动测试',
        body:'已通过插件启动后台触发，无需打开插件页面。本次启动只测试一次 Windows 通知，不会使用重置卡。'});
      if(result?.accepted!==true)throw new Error('Windows 未确认接受测试通知');
      const accepted=structuredClone(this.state);accepted.lastAttempt.status='accepted';accepted.lastAttempt.acceptedAt=this.now();await this.save(accepted);
    }catch(error){
      const failed=structuredClone(this.state);failed.lastAttempt.status='failed';failed.lastAttempt.error=error.message;await this.save(failed);
    }
  }
}
