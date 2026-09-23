import { requireUser,requireAdmin,sameOrigin } from '@/src/server/app/auth';
import { body,handle,json } from '@/src/server/app/http';
import { mutate } from '@/src/server/app/db';
import { demoAction } from '@/src/server/app/operations';
import { z } from 'zod';
export async function POST(req:Request){return handle(async()=>{sameOrigin(req);const u=await requireUser(req);requireAdmin(u);const v=z.object({action:z.enum(['reset','busy','occupy','part']),optionId:z.string().optional()}).strict().parse(await body(req));const r=await mutate((s,now)=>demoAction(s,u,now,v.action,v.optionId));return json({ok:true,data:r.value})})}
