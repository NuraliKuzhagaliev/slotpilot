import { AppStateSchema, type AppState } from '../../contracts/app.ts';
import { supabaseHeaders } from './supabase-headers.mjs';
import { initialState, dataset } from './state.ts';
export class AppError extends Error{code:string;status:number;constructor(code:string,message:string,status=400){super(message);this.code=code;this.status=status}}
export function config(){return {url:process.env.SUPABASE_URL??'',key:process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'',namespace:process.env.DEMO_NAMESPACE??'slotpilot-demo'}}
export function dbConfigured(){const c=config();return Boolean(c.url&&c.key)}
export async function rpc<T>(name:string,args:unknown):Promise<T>{const c=config();if(!c.url||!c.key)throw new AppError('SETUP_REQUIRED','The booking database has not been connected yet.',503);let res:Response;
 try{res=await fetch(`${c.url.replace(/\/$/,'')}/rest/v1/rpc/${name}`,{method:'POST',headers:supabaseHeaders(c.key),body:JSON.stringify(args),signal:AbortSignal.timeout(15000),cache:'no-store'})}catch{throw new AppError('DATABASE_UNAVAILABLE','Cannot reach the booking database. Check the saved result before retrying.',503)}
 const data=await res.json().catch(()=>({})) as {code?:string};if(!res.ok){if(data.code==='23P01')throw new AppError('SLOT_CONFLICT','This technician or bay was just booked. Find a new option.',409);console.error('SlotPilot database RPC failed',{operation:name,status:res.status,code:data.code??'unknown'});throw new AppError('DATABASE_UNAVAILABLE',res.status>=500||res.status===429?'The database is temporarily unavailable. Please try again.':'Database configuration needs attention. Please contact the site owner.',503)}return data as T;
}
interface Row{revision:number;document:AppState}
export async function readState(){const row=await rpc<Row>('slotpilot_load',{p_namespace:config().namespace,p_initial:initialState(new Date().toISOString())});return {...row,document:AppStateSchema.parse(row.document)}}
export async function mutate<T>(fn:(state:AppState,now:string)=>T):Promise<{value:T;state:AppState}>{
 for(let attempt=0;attempt<5;attempt++){const row=await readState();const now=new Date().toISOString();const state=structuredClone(row.document);const value=fn(state,now);const validated=AppStateSchema.parse(state);const reservations=dataset(validated,now).reservations.filter(r=>r.status==='active');const result=await rpc<{committed:boolean}>('slotpilot_commit',{p_namespace:config().namespace,p_expected_revision:row.revision,p_document:validated,p_reservations:reservations});if(result.committed)return {value,state:validated}}
 throw new AppError('OPERATION_PENDING','Another change is being saved. Refresh and check the current result.',409)
}
export async function rateLimit(key:string,max:number,seconds:number){const allowed=await rpc<boolean>('slotpilot_rate_limit',{p_namespace:config().namespace,p_key:key,p_limit:max,p_seconds:seconds});if(!allowed)throw new AppError('RATE_LIMIT','Too many attempts. Please wait before trying again.',429)}
