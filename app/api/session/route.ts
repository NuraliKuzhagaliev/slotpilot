import { currentUser,login,sameOrigin } from '@/src/server/app/auth';
import { body,handle,json } from '@/src/server/app/http';
import { z } from 'zod';
export async function GET(req:Request){return json({user:await currentUser(req)})}
export async function POST(req:Request){return handle(async()=>{const v=z.object({role:z.enum(['client','admin']),password:z.string().max(256)}).strict().parse(await body(req));const r=await login(req,v.role,v.password);return json({user:r.user},200,{'Set-Cookie':r.cookie})})}
export async function DELETE(req:Request){return handle(async()=>{sameOrigin(req);return json({ok:true},200,{'Set-Cookie':'slotpilot_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'})})}
