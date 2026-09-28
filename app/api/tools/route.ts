import { requireUser,sameOrigin } from '@/src/server/app/auth';
import { body,handle,json } from '@/src/server/app/http';
import { mutate,rateLimit } from '@/src/server/app/db';
import { idempotentTool } from '@/src/server/app/operations';
import { snapshot } from '@/src/server/app/state';
import { ToolNameSchema,parseToolArguments } from '@/src/contracts/tools';
import { ErrorResponseSchema } from '@/src/contracts/app';
import { z } from 'zod';
export async function POST(req:Request){
 const started=performance.now();let toolName='invalid';let callId:string|undefined;
 const response=await handle(async()=>{
  sameOrigin(req);const u=await requireUser(req);await rateLimit(`tools-${u.userId}`,90,60);
  const input=z.object({name:z.string(),callId:z.string().min(1).max(200),arguments:z.unknown(),requestId:z.string().min(1)}).strict().parse(await body(req));
  const name=ToolNameSchema.parse(input.name);toolName=name;
  if(/^[a-zA-Z0-9_-]{1,100}$/.test(input.callId))callId=input.callId;
  const args=parseToolArguments(name,input.arguments);
  const r=await mutate((s,now)=>{if(s.sessions[u.userId]?.requestId!==input.requestId)throw Object.assign(new Error('This request is no longer active.'),{code:'STALE_REQUEST'});return idempotentTool(s,u,input.callId,name,args,now)});
  return json({ok:true,data:r.value,...snapshot(r.state,u)});
 });
 // Never include tool arguments, confirmation evidence, user IDs or auth data.
 const code=response.ok?undefined:ErrorResponseSchema.parse(await response.clone().json()).error.code;
 console.info(JSON.stringify({event:'voice.tool',name:toolName,callId,status:response.status,code,durationMs:Math.round(performance.now()-started)}));
 return response;
}
