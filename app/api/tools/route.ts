import { requireUser,sameOrigin } from '@/src/server/app/auth';
import { body,handle,json } from '@/src/server/app/http';
import { mutate,rateLimit } from '@/src/server/app/db';
import { idempotentTool } from '@/src/server/app/operations';
import { snapshot } from '@/src/server/app/state';
import { ToolNameSchema } from '@/src/contracts/tools';
import { z } from 'zod';
export async function POST(req:Request){return handle(async()=>{sameOrigin(req);const u=await requireUser(req);await rateLimit(`tools-${u.userId}`,90,60);const input=z.object({name:z.string(),callId:z.string().min(1).max(200),arguments:z.unknown(),requestId:z.string().min(1)}).strict().parse(await body(req));const name=ToolNameSchema.parse(input.name);const r=await mutate((s,now)=>{if(s.sessions[u.userId]?.requestId!==input.requestId)throw Object.assign(new Error('This request is no longer active.'),{code:'STALE_REQUEST'});return idempotentTool(s,u,input.callId,name,input.arguments,now)});return json({ok:true,data:r.value,...snapshot(r.state,u)})})}
