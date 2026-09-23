// Real Supabase/PostgreSQL test. Never substitutes an in-memory database.
import assert from 'node:assert/strict';
import { supabaseHeaders } from '../src/server/app/supabase-headers.mjs';
import { existsSync } from 'node:fs';
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key){console.error('BLOCKED: configure Supabase and apply the migration first. No PostgreSQL tests were run.');process.exit(2)}
const namespace='slotpilot-test-'+crypto.randomUUID();
async function rpc(name,args,allowError=false){const r=await fetch(url.replace(/\/$/,'')+'/rest/v1/rpc/'+name,{method:'POST',headers:supabaseHeaders(key),body:JSON.stringify(args)});const d=await r.json();if(!r.ok&&!allowError)throw new Error(`PostgreSQL RPC failed: ${d.code??r.status}`);return {status:r.status,data:d}}
const document={schemaVersion:1,bookings:{},testOnly:true};const initial=await rpc('slotpilot_load',{p_namespace:namespace,p_initial:document});assert.equal(initial.data.revision,0);
const reservation=(id,start,end)=>({id,resourceId:'shared-technician',resourceKind:'technician',startAt:start,endAt:end,status:'active'});
const first=reservation('one','2030-01-01T10:00:00Z','2030-01-01T11:00:00Z');
const args={p_namespace:namespace,p_expected_revision:0,p_document:{...document,bookings:{one:{status:'confirmed'}}},p_reservations:[first]};
const race=await Promise.all([rpc('slotpilot_commit',args),rpc('slotpilot_commit',{...args,p_document:{...document,bookings:{two:{status:'confirmed'}}}})]);assert.equal(race.filter(x=>x.data.committed).length,1);console.log('PASS: two concurrent stale commits cannot both win.');
const overlapping={...args,p_expected_revision:1,p_reservations:[first,reservation('two','2030-01-01T10:30:00Z','2030-01-01T11:30:00Z')]};const conflict=await rpc('slotpilot_commit',overlapping,true);assert.equal(conflict.data.code,'23P01');const after=await rpc('slotpilot_load',{p_namespace:namespace,p_initial:document});assert.equal(after.data.revision,1);console.log('PASS: PostgreSQL exclusion rejects overlap and rolls back the whole transaction.');
const adjacent=await rpc('slotpilot_commit',{...args,p_expected_revision:1,p_reservations:[first,reservation('two','2030-01-01T11:00:00Z','2030-01-01T12:00:00Z')]});assert.equal(adjacent.data.committed,true);console.log('PASS: adjacent half-open intervals are accepted.');
const other='slotpilot-test-'+crypto.randomUUID();await rpc('slotpilot_load',{p_namespace:other,p_initial:document});const isolated=await rpc('slotpilot_commit',{...args,p_namespace:other});assert.equal(isolated.data.committed,true);console.log('PASS: namespace isolation permits independent resource calendars.');
for(const [n,rev]of [[namespace,2],[other,1]])await rpc('slotpilot_commit',{p_namespace:n,p_expected_revision:rev,p_document:document,p_reservations:[]});
console.log('Finished. Test namespaces contain only empty test documents; production demo data was untouched.');
