import { AppError, config, rateLimit } from './db.ts';
import { supabaseHeaders } from './supabase-headers.mjs';
import type { User } from '../../contracts/app.ts';
type AuthAccount={id:string;updated_at?:string;banned_until?:string;app_metadata?:{role?:string}};
type AccountSession=User&{exp:number;authorityStamp?:string};
const encoder=new TextEncoder(),cookieName='slotpilot_account';
// Browser-safe public key for the existing demo project. Never use a service key here.
const demoPublishableKey='sb_publishable_-rt9Ylj2doGXvQKLt7-Vzw_Zxm_kKlS';
function publishableKey(){return process.env.SUPABASE_PUBLISHABLE_KEY||(process.env.SUPABASE_URL?.includes('lylcxxdrpralrstxzuct.supabase.co')?demoPublishableKey:'')}
export function authConfigured(){return Boolean(process.env.SUPABASE_URL&&(process.env.SESSION_SECRET?.length??0)>=32&&publishableKey())}
async function sign(s:string){const secret=process.env.SESSION_SECRET;if(!secret||secret.length<32)throw new AppError('SETUP_REQUIRED','The server session secret is not configured.',503);const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Buffer.from(await crypto.subtle.sign('HMAC',key,encoder.encode(s))).toString('base64url')}
export function sameOrigin(req:Request){const origin=req.headers.get('origin');if(!origin||origin!==new URL(req.url).origin)throw new AppError('NOT_AUTHORIZED','Use this application to perform the action.',403)}
async function equal(a:string,b:string){const x=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(a)));const y=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(b)));let n=0;for(let i=0;i<x.length;i++)n|=x[i]^y[i];return n===0}
async function authRequest(path:string,payload:unknown,token?:string){const url=process.env.SUPABASE_URL,key=publishableKey();if(!url||!key)throw new AppError('SETUP_REQUIRED','Supabase Auth is not configured.',503);let response:Response;try{response=await fetch(`${url.replace(/\/$/,'')}/auth/v1/${path}`,{method:token?'PUT':'POST',headers:{apikey:key,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(payload),cache:'no-store',signal:AbortSignal.timeout(10000)})}catch{throw new AppError('PROVIDER_UNREACHABLE','Authentication is temporarily unavailable. Please try again.',503)}
 const data=await response.json().catch(()=>({}));if(!response.ok){if(response.status===429)throw new AppError('RATE_LIMIT','Too many requests. Please try again later.',429);if(path==='resend'||path.startsWith('recover?'))throw new AppError('PROVIDER_ERROR','The email request could not be completed. Please try again later.',502);throw new AppError('NOT_AUTHORIZED',path.startsWith('token')?'Incorrect email or password, or email not yet confirmed.':'Could not complete account request. Check your details or try again later.',400)}return data as {access_token?:string;user?:AuthAccount}}
function cookieAttributes(req:Request,maxAge:number){return `; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${new URL(req.url).protocol==='https:'?'; Secure':''}`}
export function clearSessionCookie(req:Request){return cookieName+'='+cookieAttributes(req,0)}
async function sessionCookie(req:Request,user:User,authorityStamp?:string){const body=Buffer.from(JSON.stringify({...user,authorityStamp,exp:Date.now()+86400000})).toString('base64url');return `${cookieName}=${body}.${await sign(body)}${cookieAttributes(req,86400)}`}
async function accountSession(req:Request):Promise<AccountSession|null>{
 try{
  const token=req.headers.get('cookie')?.split(';').map(c=>c.trim()).find(c=>c.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
  if(!token)return null;
  const [body,mac,extra]=token.split('.');
  if(!body||!mac||extra!==undefined||!await equal(mac,await sign(body)))return null;
  const data=JSON.parse(Buffer.from(body,'base64url').toString()) as AccountSession;
  if(!Number.isFinite(data.exp)||data.exp<=Date.now()||!['client','admin'].includes(data.role)||typeof data.userId!=='string')return null;
  return data;
 }catch{return null}
}
export async function currentUser(req:Request):Promise<User|null>{const data=await accountSession(req);return data?{userId:data.userId,role:data.role}:null}
export async function requireUser(req:Request){const user=await currentUser(req);if(!user)throw new AppError('NOT_AUTHORIZED','Sign in to save a booking.',401);return user}
export async function requireAdmin(req:Request):Promise<User>{
 const signed=await accountSession(req);
 if(!signed)throw new AppError('NOT_AUTHORIZED','Sign in with an administrator account.',401);
 if(signed.role!=='admin'||!signed.authorityStamp)throw new AppError('NOT_AUTHORIZED','Sign in again with an administrator account.',403);
 const {url,key}=config();
 if(!url||!key)throw new AppError('SETUP_REQUIRED','Administrator verification is not configured.',503);
 const unavailable=()=>new AppError('PROVIDER_UNREACHABLE','Administrator verification is temporarily unavailable.',503);
 let response:Response;
 try{
  response=await fetch(`${url.replace(/\/$/,'')}/auth/v1/admin/users/${encodeURIComponent(signed.userId)}`,{headers:supabaseHeaders(key),cache:'no-store',signal:AbortSignal.timeout(6000)});
 }catch{throw unavailable()}
 if(response.status===404)throw new AppError('NOT_AUTHORIZED','Administrator access has changed. Sign in again.',403);
 if(!response.ok)throw unavailable();
 const account=await response.json().catch(()=>null) as AuthAccount|null;
 if(account?.id!==signed.userId||account.app_metadata?.role!=='admin'||Date.parse(account.updated_at??'')!==Date.parse(signed.authorityStamp)||Date.parse(account.banned_until??'')>Date.now()){
  throw new AppError('NOT_AUTHORIZED','Administrator access has changed. Sign in again.',403);
 }
 return {userId:signed.userId,role:'admin'};
}
export async function login(req:Request,email:string,password:string){
 sameOrigin(req);
 await rateLimit('login-global',60,600);
 const result=await authRequest('token?grant_type=password',{email,password});
 if(!result.user?.id||!result.access_token)throw new AppError('NOT_AUTHORIZED','Confirm your email, then sign in.',401);
 const user:User={userId:result.user.id,role:result.user.app_metadata?.role==='admin'?'admin':'client'};
 return {user,cookie:await sessionCookie(req,user,user.role==='admin'?result.user.updated_at:undefined)};
}
export async function signUp(req:Request,email:string,password:string){sameOrigin(req);await rateLimit('signup-global',30,3600);await authRequest('signup',{email,password});return {message:'Check your email to confirm the account, then sign in.'}}
export async function resendConfirmation(req:Request,email:string){sameOrigin(req);await rateLimit('resend-confirmation-global',20,3600);await authRequest('resend',{email,type:'signup'});return {message:'If this account still needs confirmation, a new email has been requested. Check your inbox and spam folder.'}}
export async function recover(req:Request,email:string){sameOrigin(req);await rateLimit('recover-global',20,3600);await authRequest(`recover?redirect_to=${encodeURIComponent(new URL('/',req.url).href)}`,{email});return {message:'If this address has an account, you will receive a password reset email.'}}
export async function resetPassword(req:Request,accessToken:string,password:string){sameOrigin(req);await authRequest('user',{password},accessToken);return {message:'Password updated. Please sign in.'}}
