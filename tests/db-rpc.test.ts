import test from 'node:test';
import assert from 'node:assert/strict';
import { rpc } from '../src/server/app/db.ts';

test('a one-off Supabase PGRST303 is retried once and a persistent failure is bounded',async()=>{
 const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SECRET_KEY,oldFetch=globalThis.fetch,oldLog=console.error;
 process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_SECRET_KEY='sb_secret_test';console.error=()=>{};
 try{
  let calls=0;globalThis.fetch=async()=>{calls++;return calls===1?Response.json({code:'PGRST303'},{status:401}):Response.json({revision:2})};
  assert.deepEqual(await rpc('slotpilot_load',{p_namespace:'test'}),{revision:2});assert.equal(calls,2);
  calls=0;globalThis.fetch=async()=>{calls++;return Response.json({code:'PGRST303'},{status:401})};
  await assert.rejects(rpc('slotpilot_load',{}),{code:'DATABASE_UNAVAILABLE'});assert.equal(calls,2);
 }finally{globalThis.fetch=oldFetch;console.error=oldLog;if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=oldKey}
});
