import { BrowserAudio } from './audio.mjs';
export async function api(path,body){const r=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Object.assign(new Error(d.error?.message||'Request failed.'),{code:d.error?.code});return d}
export class VoiceController{
 constructor(callbacks){this.c=callbacks;this.active=false;this.generation=0;this.epoch=0;this.pending=[];this.seen=new Set();this.chain=Promise.resolve();this.confirmationRef=null;this.suppressed=new Set();this.replyId=null;this.playing=false;this.speechFrames=0;this.noiseFloor=.006;this.lastEvent='';}
 emit(n,v){this.c[n]?.(v)}
 send(m){if(this.socket?.readyState===1)this.socket.send(JSON.stringify(m))}
 event(type){this.emit('event',{type,at:new Date().toISOString()})}
 flush(){if(this.lastEvent!=='reply.done')return;for(const p of this.pending.splice(0)){if(p.epoch===this.epoch){this.send(p.frame);this.event('tool.result.sent')}}}
 cut(source){if(this.replyId)this.suppressed.add(this.replyId);this.dropAudio=true;this.audio?.clear();this.playing=false;this.emit('state','listening');this.event(`playback.cleared.${source}`)}
 async start(){if(this.active)return;this.active=true;const g=++this.generation;this.emit('state','connecting');this.audio=new BrowserAudio(buffer=>{if(!this.ready||this.socket?.readyState!==1)return;if(this.socket.bufferedAmount>48000){void this.stop();this.emit('error','Network is too slow. Conversation stopped; saved bookings remain intact.');return}
  // 20ms frames; echo-cancelled sustained input mutes locally without waiting for network.
  const pcm=new Int16Array(buffer);let power=0;for(const n of pcm)power+=(n/32768)**2;const rms=Math.sqrt(power/pcm.length);
  if(!this.playing)this.noiseFloor=.98*this.noiseFloor+.02*Math.min(rms,.03);
  this.speechFrames=this.playing&&rms>Math.max(.027,this.noiseFloor*4)?this.speechFrames+1:0;
  if(this.speechFrames>=3){this.cut('local');this.speechFrames=0}
  let raw='';for(const b of new Uint8Array(buffer))raw+=String.fromCharCode(b);this.send({type:'input.audio',audio:btoa(raw)});
 },kind=>{if(kind==='drained'){this.playing=false;this.emit('state','listening')}if(kind==='overflow'||kind==='invalid-audio'){this.emit('error','Audio could not keep up. Restart the conversation.');void this.stop()}});
 try{await this.audio.open();if(g!==this.generation)return;const token=await api('/api/voice/token',{consent:true});if(g!==this.generation)return;this.basePrompt=token.session.system_prompt;const url=new URL(token.websocketUrl);if(url.origin!=='wss://agents.assemblyai.com'||url.pathname!=='/v1/ws')throw new Error('Invalid voice endpoint');url.searchParams.set('token',token.token);const ws=new WebSocket(url);this.socket=ws;
 this.connectTimer=setTimeout(()=>{this.emit('error','Voice connection timed out.');void this.stop()},20000);
 ws.onopen=()=>{if(g!==this.generation){ws.close();return}this.send({type:'session.update',session:token.session})};
 ws.onmessage=({data})=>{if(g!==this.generation)return;let e;try{e=JSON.parse(data)}catch{return}const t=e.type;
  if(t==='session.ready'){clearTimeout(this.connectTimer);this.ready=true;this.emit('state','listening');this.event('voice.connected');this.durationTimer=setTimeout(()=>void this.stop(),token.maxSessionSeconds*1000)}
  if(t==='input.speech.started'){this.epoch++;this.pending=[];this.lastEvent=t;this.confirmationRef=null;this.cut('provider');this.chain=this.chain.then(()=>api('/api/evidence',{kind:'speech_started'})).catch(()=>{});this.userSpeechStarted=performance.now()}
  if(t==='input.speech.stopped')this.speechStopped=performance.now();
  if(t==='reply.started'){this.lastEvent=t;this.replyId=e.reply_id;this.dropAudio=false;this.emit('state','thinking')}
  if(t==='reply.audio'&&!this.dropAudio&&!this.suppressed.has(e.reply_id)){this.audio.play(e.data);if(!this.playing&&this.speechStopped){this.emit('latency',Math.round(performance.now()-this.speechStopped));this.speechStopped=null}this.playing=true;this.emit('state','responding')}
  if(t==='reply.done'){this.lastEvent=t;if(e.status==='interrupted'){this.epoch++;this.pending=[];this.cut('interrupted')}else this.flush()}
  if(['transcript.user','transcript.user.delta','transcript.agent'].includes(t)&&typeof e.text==='string'){
   this.emit('transcript',{id:`${t==='transcript.agent'?'agent':'user'}:${e.item_id??e.reply_id??'current'}`,speaker:t==='transcript.agent'?'agent':'user',text:e.text,final:t!=='transcript.user.delta'});
   if(t==='transcript.user'){const epoch=this.epoch;const action=this.c.snapshot()?.request?.preparedAction;if(action)this.chain=this.chain.then(async()=>{if(epoch!==this.epoch)return;const ev=await api('/api/evidence',{kind:'confirmation',actionId:action.actionId,source:'voice',text:e.text,itemId:e.item_id??crypto.randomUUID()});if(epoch===this.epoch)this.confirmationRef=ev.confirmationRef}).catch(()=>{this.confirmationRef=null})}
  }
  if(t==='tool.call'&&!this.seen.has(e.call_id)){this.seen.add(e.call_id);const epoch=this.epoch;const write=['confirm_booking','reschedule_booking','cancel_booking','create_callback_request'].includes(e.name);this.chain=this.chain.then(async()=>{
    if(epoch!==this.epoch)return;let args=typeof e.arguments==='string'?JSON.parse(e.arguments):e.arguments;
    if(['confirm_booking','reschedule_booking','cancel_booking'].includes(e.name))args={...args,confirmationRef:this.confirmationRef??'no-evidence'};
    let result;try{result=await api('/api/tools',{callId:e.call_id,name:e.name,arguments:args,requestId:this.c.snapshot()?.request?.requestId});this.emit('updateSnapshot',result)}catch(error){result={ok:false,error:{code:error.code??'CONNECTION_ERROR',message:error.message}};if(write)await this.c.reconcile?.()}
    // A write result always updates UI/reconciles above, even if speech moved on.
    if(epoch!==this.epoch){this.event('tool.result.stale');return}
    this.pending.push({epoch,frame:{type:'tool.result',call_id:e.call_id,result:JSON.stringify(result),is_error:result.ok===false}});this.flush();
  }).catch(()=>this.emit('error','A tool call failed. Check the saved visit state.'))}
  if(t==='session.error'||t==='error'){this.emit('error','AssemblyAI reported a connection error. Check account access and credits.');void this.stop()}
  if(t==='session.ended')void this.stop();
 };
 ws.onerror=()=>{this.emit('error','Voice connection failed.');void this.stop()};ws.onclose=()=>{if(g===this.generation){this.emit('error','Voice disconnected. Checking the saved visit.');void this.stop();void this.c.reconcile?.()}};
 }catch(e){this.emit('error',e.name==='NotAllowedError'?'Allow microphone access, then try again.':e.message);await this.stop()}}
 sync(){if(!this.active)return;this.cut('manual-edit');this.epoch++;this.pending=[];this.confirmationRef=null;const s=this.c.snapshot();this.send({type:'session.update',session:{system_prompt:`${this.basePrompt}\nMANUAL UPDATE: Previous proposals are superseded. CURRENT AUTHORITATIVE STATE: ${JSON.stringify(s?.request)}. Use this latest requestVersion and conditions before recommending anything.`}})}
 async stop(){if(!this.active)return;this.active=false;this.ready=false;this.generation++;this.epoch++;this.pending=[];clearTimeout(this.durationTimer);clearTimeout(this.connectTimer);const ws=this.socket;this.socket=null;if(ws?.readyState===1){ws.send(JSON.stringify({type:'session.end'}));const timer=setTimeout(()=>ws.close(),1200);ws.addEventListener('message',e=>{try{if(JSON.parse(e.data).type==='session.ended'){clearTimeout(timer);ws.close()}}catch{}})}else if(ws?.readyState===0)ws.close();const a=this.audio;this.audio=null;await a?.close();this.emit('state','idle');this.event('voice.stopped')}
}
