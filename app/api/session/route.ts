import {clearSessionCookie,currentUser,login,recover,resetPassword,resendConfirmation,sameOrigin,signUp} from '@/src/server/app/auth';
import {body,handle,json} from '@/src/server/app/http';
import {z} from 'zod';
const credentials=z.object({email:z.string().email().max(254),password:z.string().min(8).max(256)}).strict();
export async function GET(req:Request){return json({user:await currentUser(req)})}
export async function POST(req:Request){
 return handle(async()=>{
  const input=z.discriminatedUnion('action',[
   credentials.extend({action:z.literal('login')}),
   credentials.extend({action:z.literal('signup')}),
   z.strictObject({action:z.literal('resend'),email:z.string().email().max(254)}),
   z.strictObject({action:z.literal('recover'),email:z.string().email().max(254)}),
   z.strictObject({action:z.literal('reset'),accessToken:z.string().min(20).max(4096),password:z.string().min(8).max(256)}),
  ]).parse(await body(req));
  switch(input.action){
   case 'login': {
    const result=await login(req,input.email,input.password);
    return json({user:result.user},200,{'Set-Cookie':result.cookie});
   }
   case 'signup': return json(await signUp(req,input.email,input.password));
   case 'resend': return json(await resendConfirmation(req,input.email));
   case 'recover': return json(await recover(req,input.email));
   case 'reset': return json(await resetPassword(req,input.accessToken,input.password),200,{'Set-Cookie':clearSessionCookie(req)});
  }
 });
}
export async function DELETE(req:Request){return handle(async()=>{sameOrigin(req);return json({ok:true},200,{'Set-Cookie':clearSessionCookie(req)})})}
