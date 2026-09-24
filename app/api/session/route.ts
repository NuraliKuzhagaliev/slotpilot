import {currentUser,login,recover,resetPassword,sameOrigin,signUp} from '@/src/server/app/auth';
import {body,handle,json} from '@/src/server/app/http';
import {z} from 'zod';
const credentials=z.object({email:z.string().email().max(254),password:z.string().min(8).max(256)}).strict();
export async function GET(req:Request){return json({user:await currentUser(req)})}
export async function POST(req:Request){return handle(async()=>{const input=z.discriminatedUnion('action',[credentials.extend({action:z.literal('login')}),credentials.extend({action:z.literal('signup')}),z.object({action:z.literal('recover'),email:z.string().email().max(254)}).strict(),z.object({action:z.literal('reset'),accessToken:z.string().min(20).max(4096),password:z.string().min(8).max(256)}).strict()]).parse(await body(req));if(input.action==='login'){const r=await login(req,input.email,input.password);return json({user:r.user},200,{'Set-Cookie':r.cookie})}if(input.action==='signup')return json(await signUp(req,input.email,input.password));if(input.action==='recover')return json(await recover(req,input.email));return json(await resetPassword(req,input.accessToken,input.password))})}
export async function DELETE(req:Request){return handle(async()=>{sameOrigin(req);return json({ok:true},200,{'Set-Cookie':'slotpilot_account=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'})})}
