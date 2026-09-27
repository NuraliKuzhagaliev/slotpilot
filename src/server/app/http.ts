import { AppError } from './db.ts';
import { ErrorResponseSchema } from '../../contracts/app.ts';
import { ErrorCodeSchema } from '../../contracts/domain.ts';
export const json=(data:unknown,status=200,headers:Record<string,string>={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
export async function body(req:Request){if(Number(req.headers.get('content-length')??0)>32768)throw new AppError('VALIDATION_ERROR','Request too large.',413);const text=await req.text();if(text.length>32768)throw new AppError('VALIDATION_ERROR','Request too large.',413);try{return JSON.parse(text)}catch{throw new AppError('VALIDATION_ERROR','Invalid JSON.')}}
function validationMessage(err:Error&{path?:unknown;issues?:unknown}):string{
  // Contract messages contain fixed schema reasons, never the supplied value.
  // Only expose schema-shaped paths; record keys may originate from users.
  if(err.name==='ContractError'&&typeof err.path==='string'&&/^\$(?:\.[A-Za-z][A-Za-z0-9]*|\[\d+\])*$/.test(err.path)&&err.path.length<=120){
    const reason=err.message.slice(err.path.length+2);
    if(/^[A-Za-z .-]{1,100}$/.test(reason))return `Invalid ${err.path}: ${reason} Correct the tool arguments and retry.`;
  }
  if(err.name==='ZodError'&&Array.isArray(err.issues)){
    const issue=err.issues[0] as {path?:unknown};
    if(Array.isArray(issue?.path)&&issue.path.every(part=>typeof part==='number'||typeof part==='string'&&/^[A-Za-z][A-Za-z0-9]*$/.test(part))){
      const path=issue.path.map(part=>typeof part==='number'?`[${part}]`:`.${part}`).join('');
      if(path.length<=120)return `Invalid request field $${path}. Check the supplied values and retry.`;
    }
  }
  return 'Check the supplied values and retry.';
}
export async function handle(fn:()=>Promise<Response>){try{return await fn()}catch(e){const err=e as Error&{code?:string;status?:number};const validation=err.name==='ContractError'||err.name==='ZodError';let code='INTERNAL_ERROR';try{code=ErrorCodeSchema.parse(err.code)}catch{}return json(ErrorResponseSchema.parse({ok:false,error:{code:validation?'VALIDATION_ERROR':code,message:validation?validationMessage(err):code!=='INTERNAL_ERROR'?err.message:'The operation could not be completed. Refresh the saved state before retrying.',nextAction:'refresh_state'}}),err.status??(validation?400:code!=='INTERNAL_ERROR'?409:500))}}
