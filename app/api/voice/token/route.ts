import { requireUser,sameOrigin } from '@/src/server/app/auth';
import { handle,json,body } from '@/src/server/app/http';
import { AppError,mutate,rateLimit } from '@/src/server/app/db';
import { request,session } from '@/src/server/app/state';
import { bookingSession } from '@/agents/booking';
import { z } from 'zod';

export async function POST(req:Request){return handle(async()=>{
 sameOrigin(req);
 const user=await requireUser(req);
 z.object({consent:z.literal(true)}).strict().parse(await body(req));
 const key=process.env.ASSEMBLYAI_API_KEY;
 if(!key)throw new AppError('KEY_NOT_CONFIGURED','Voice is not configured. You can still book using the form.',503);
 const reservedAt=Date.now();
 const now=new Date(reservedAt).toISOString();
 const result=await mutate(state=>{
  const row=session(state,user);
  row.tokenTimes=row.tokenTimes.filter(time=>time>reservedAt-86400000);
  const limit=Math.min(30,Math.max(1,Number(process.env.VOICE_DAILY_TOKEN_LIMIT)||10));
  if(row.tokenTimes.length>=limit){
   const retryAt=new Date(Math.min(...row.tokenTimes)+86400000).toISOString().replace('T',' ').slice(0,16);
   throw new AppError('VOICE_LIMIT',`Voice demo limit reached. Try again after ${retryAt} UTC.`,429);
  }
  // Distinguish attempts arriving within the same millisecond. A failed one
  // must never refund another request's successfully issued token.
  const reservation=Math.max(reservedAt,...row.tokenTimes.map(time=>time+1));
  row.tokenTimes.push(reservation);
  return {request:request(state,user),reservation};
 });
 try{
  await rateLimit(`voice-${user.userId}`,10,600,'Too many voice starts. Wait up to 10 minutes from the first attempt.');
  const duration=Math.min(600,Math.max(60,Number(process.env.VOICE_MAX_SESSION_SECONDS)||300));
  const url=new URL('https://agents.assemblyai.com/v1/token');
  url.searchParams.set('expires_in_seconds','60');
  url.searchParams.set('max_session_duration_seconds',String(duration));
  let response:Response;
  try{response=await fetch(url,{headers:{Authorization:`Bearer ${key}`},redirect:'error',signal:AbortSignal.timeout(12000)})}
  catch{throw new AppError('PROVIDER_UNREACHABLE','Could not reach AssemblyAI.',502)}
  if(!response.ok)throw new AppError('PROVIDER_ACCESS_DENIED','Check Voice Agent API access and account credits.',502);
  const data=await response.json() as {token?:unknown};
  if(typeof data.token!=='string'||data.token.length>16000)throw new AppError('PROVIDER_ERROR','Invalid provider token response.',502);
  await rateLimit('voice-global',30,86400,'Voice demo daily capacity is exhausted. Try again after the 24-hour window resets.');
  return json({token:data.token,websocketUrl:'wss://agents.assemblyai.com/v1/ws',maxSessionSeconds:duration,session:bookingSession(now,result.value.request)});
 }catch(error){
  // A failed provider request or global quota check must not consume the user's daily token allowance.
  try{await mutate(state=>{const row=session(state,user);row.tokenTimes=row.tokenTimes.filter(time=>time!==result.value.reservation)})}
  catch{console.error('SlotPilot could not release an unused voice token reservation')}
  throw error;
 }
})}
