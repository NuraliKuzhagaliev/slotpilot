import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL,fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
registerHooks({resolve(specifier,context,next){
 if(specifier.startsWith('@/')){
  const file=resolve(root,specifier.slice(2));
  return next(pathToFileURL(existsSync(file)?file:file+'.ts').href,context);
 }
 return next(specifier,context);
}});

test('failed provider tokens release the daily reservation and successful tokens consume it',async()=>{
 const names=['SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_PUBLISHABLE_KEY','SESSION_SECRET','ASSEMBLYAI_API_KEY','DEMO_NAMESPACE','VOICE_DAILY_TOKEN_LIMIT'];
 const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 const originalFetch=globalThis.fetch;
 const originalNow=Date.now;
 const fixedTime=Date.now();
 Date.now=()=>fixedTime; // Exercise successful and failed attempts in the same millisecond.
 Object.assign(process.env,{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SESSION_SECRET:'test-only-hmac-secret-which-is-at-least-32-characters',ASSEMBLYAI_API_KEY:'test-provider-key',DEMO_NAMESPACE:'slotpilot-test-voice-token',VOICE_DAILY_TOKEN_LIMIT:'1'});
 const {initialState,newRequest}=await import('../src/server/app/state.ts');
 const user={userId:'voice-route-user',role:'client'};
 let document=initialState(new Date().toISOString()),revision=0,providerCalls=0,globalChecks=0,blockUser=false;
 newRequest(document,user,process.env.DEMO_NAMESPACE);
 globalThis.fetch=async(input,options)=>{
  const url=String(input);
  if(url.endsWith('/slotpilot_rate_limit')){
   const args=JSON.parse(options.body);
   if(args.p_key==='voice-global')globalChecks++;
   return Response.json(!(blockUser&&args.p_key===`voice-${user.userId}`));
  }
  if(url.endsWith('/slotpilot_load'))return Response.json({revision,document});
  if(url.endsWith('/slotpilot_commit')){
   const args=JSON.parse(options.body);
   assert.equal(args.p_expected_revision,revision);
   document=args.p_document;revision++;
   return Response.json({committed:true,revision});
  }
  if(url.includes('/auth/v1/token'))return Response.json({access_token:'test-access',user:{id:user.userId,app_metadata:{role:'client'}}});
  if(url.includes('agents.assemblyai.com/v1/token')){
   providerCalls++;
   return providerCalls===1?Response.json({}, {status:503}):Response.json({token:'test-temporary-token'});
  }
  throw new Error('Unexpected request: '+url);
 };
 try{
  const {login}=await import('../src/server/app/auth.ts');
  const {POST}=await import('../app/api/voice/token/route.ts');
  const origin='https://slotpilot.test';
  const loginRequest=new Request(origin+'/api/session',{headers:{origin}});
  const cookie=(await login(loginRequest,'test@example.com','test-password')).cookie.split(';')[0];
  const post=()=>POST(new Request(origin+'/api/voice/token',{method:'POST',headers:{origin,cookie,'Content-Type':'application/json'},body:JSON.stringify({consent:true})}));
  const failed=await post();
  assert.equal(failed.status,502);
  assert.equal(document.sessions[user.userId].tokenTimes.length,0);
  assert.equal(globalChecks,0);
  const success=await post();
  assert.equal(success.status,200);
  assert.equal(document.sessions[user.userId].tokenTimes.length,1);
  assert.equal(globalChecks,1);
  process.env.VOICE_DAILY_TOKEN_LIMIT='2';
  blockUser=true;
  const attemptLimited=await post();
  assert.equal(attemptLimited.status,429);
  assert.equal((await attemptLimited.json()).error.code,'RATE_LIMIT');
  assert.equal(document.sessions[user.userId].tokenTimes.length,1);
  blockUser=false;
  process.env.VOICE_DAILY_TOKEN_LIMIT='1';
  const limited=await post();
  assert.equal(limited.status,429);
  const payload=await limited.json();
  assert.equal(payload.error.code,'VOICE_LIMIT');
  assert.match(payload.error.message,/UTC/);
  assert.equal(providerCalls,2);
 }finally{
  globalThis.fetch=originalFetch;
  Date.now=originalNow;
  for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name]}
 }
});
