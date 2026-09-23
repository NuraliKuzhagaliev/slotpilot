import { requireUser,sameOrigin } from '@/src/server/app/auth';
import { body,handle,json } from '@/src/server/app/http';
import { mutate } from '@/src/server/app/db';
import { confirmEvidence,invalidateVoiceEvidence } from '@/src/server/app/operations';
import { z } from 'zod';
export async function POST(req:Request){return handle(async()=>{sameOrigin(req);const u=await requireUser(req);const input=z.union([z.object({kind:z.literal('speech_started')}).strict(),z.object({kind:z.literal('confirmation'),actionId:z.string(),source:z.enum(['button','voice']),text:z.string().max(2000).optional(),itemId:z.string().max(200).optional()}).strict()]).parse(await body(req));const r=await mutate((s,now)=>input.kind==='speech_started'?invalidateVoiceEvidence(s,u):confirmEvidence(s,u,now,input));return json(r.value??{ok:true})})}
