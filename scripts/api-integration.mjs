// Integration of real HTTP route handlers with an isolated Supabase namespace.
import {registerHooks} from "node:module";
import {resolve} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
if(existsSync('.env.local')) process.loadEnvFile('.env.local');
const origin='http://localhost:3000';
const root=fileURLToPath(new URL('../',import.meta.url));
function blocked(message){console.error('BLOCKED: '+message);process.exit(2)}
if(process.env.SLOTPILOT_TEST_BASE_URL)blocked('Unset SLOTPILOT_TEST_BASE_URL. The runner owns the namespace and calls route handlers in process.');
if(!process.env.SUPABASE_URL||!(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY)||(process.env.SESSION_SECRET?.length??0)<32){
 blocked('Configure Supabase URL and server key plus SESSION_SECRET for the integration environment.');
}
const identities=['CLIENT','OTHER_CLIENT','ADMIN'].map(role=>({
 cookie:'',
 email:process.env[`SLOTPILOT_TEST_${role}_EMAIL`],
 password:process.env[`SLOTPILOT_TEST_${role}_PASSWORD`],
 role:role==='ADMIN'?'admin':'client',
}));
if(identities.some(actor=>!actor.email||!actor.password)||new Set(identities.map(actor=>actor.email.toLowerCase())).size!==3){
 blocked('Provide confirmed and distinct CLIENT, OTHER_CLIENT and ADMIN test email/password pairs via SLOTPILOT_TEST_* variables.');
}
process.env.DEMO_NAMESPACE='slotpilot-test-'+crypto.randomUUID();
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('@/')){const file=resolve(root,specifier.slice(2));return next(pathToFileURL(existsSync(file)?file:file+'.ts').href,context)}return next(specifier,context)}});
console.log('Mode: actual route handlers in process; real Supabase/PostgreSQL; fresh isolated test namespace.');
const [client,other,admin]=identities;
let checks=0;
function pass(s){checks++;console.log('PASS: '+s)}
async function api(path,actor=client,payload,expected=200){const request=new Request(origin+path,{method:payload===undefined?'GET':'POST',headers:{Origin:origin,...(actor.cookie?{Cookie:actor.cookie}:{}),...(payload!==undefined?{'Content-Type':'application/json'}:{})},...(payload!==undefined?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(45000)});const res=await (await import(pathToFileURL(resolve(root,'app'+path+'/route.ts')).href))[request.method](request);const body=await res.json();assert.equal(res.status,expected,`${path}: ${body.error?.code||'Unexpected response'}`);const cookie=res.headers.get('set-cookie');if(cookie)actor.cookie=cookie.split(';')[0];return body}
async function login(actor){
 const {user}=await api('/api/session',actor,{action:'login',email:actor.email,password:actor.password});
 assert.equal(user.role,actor.role,'The test identity has the expected role.');
 assert.ok(actor.cookie,'A session cookie was issued.');
 return user.userId;
}
let requestId;
async function tool(name,args,actor=client,id=requestId,expected=200){return api('/api/tools',actor,{name,arguments:args,callId:crypto.randomUUID(),requestId:id},expected)}
async function newVisit(patch){let s=await api('/api/requests',client,{});requestId=s.request.requestId;s=await tool('update_request',{patch,expectedRequestVersion:s.request.requestVersion});return tool('find_options',{expectedRequestVersion:s.request.requestVersion})}
async function prepare(s,booking){const o=s.request.options[0];assert.ok(o);const a=await tool(booking?'prepare_change':'prepare_booking',booking?{changeType:'reschedule',bookingId:booking.bookingId,expectedBookingVersion:booking.bookingVersion,optionId:o.optionId,expectedRequestVersion:s.request.requestVersion}:{optionId:o.optionId,expectedRequestVersion:s.request.requestVersion});const ev=await api('/api/evidence',client,{kind:'confirmation',actionId:a.data.actionId,source:'button'});return {actionId:a.data.actionId,confirmationRef:ev.confirmationRef,optionId:o.optionId}}
const health=await api('/api/health');assert.equal(health.databaseConfigured,true);assert.equal(health.authConfigured,true);pass('runtime sees the real database and server authentication');
const userIds=[await login(client),await login(other),await login(admin)];
assert.equal(new Set(userIds).size,3,'The test accounts resolve to distinct identities.');
await api('/api/admin',client,undefined,403);await api('/api/demo',client,{action:'reset'},403);pass('client cannot access admin data or reset the database');
const patch={serviceIds:['oil-change'],vehicleId:'sedan-petrol',allowedDates:[health.catalog.dates[1]],allowedBranchIds:['centre'],arrivalNotBefore:'14:00',maxBudgetKzt:40000};
let s=await newVisit(patch);let prepared=await prepare(s);
await api('/api/demo',admin,{action:'occupy',optionId:prepared.optionId});
const conflict=await tool('confirm_booking',{actionId:prepared.actionId,confirmationRef:prepared.confirmationRef},client,requestId,409);assert.equal(conflict.error.code,'SLOT_CONFLICT');pass('a resource occupied after preparation rejects the booking');
s=await api('/api/requests');assert.equal(s.bookings.length,0);s=await tool('find_options',{expectedRequestVersion:s.request.requestVersion});prepared=await prepare(s);
const created=await tool('confirm_booking',{actionId:prepared.actionId,confirmationRef:prepared.confirmationRef});const booking=created.data;assert.equal(booking.status,'confirmed');pass('confirmed booking is saved to PostgreSQL');
const repeat=await tool('confirm_booking',{actionId:prepared.actionId,confirmationRef:prepared.confirmationRef});assert.equal(repeat.data.bookingId,booking.bookingId);assert.equal(repeat.bookings.length,1);pass('repeated confirmation returns the same booking without a duplicate');
s=await api('/api/requests');assert.equal(s.bookings[0].bookingId,booking.bookingId);pass('reloading server state preserves the saved booking');
const foreign=await api('/api/requests',other,{});const denied=await tool('get_booking',{bookingId:booking.bookingId},other,foreign.request.requestId,403);assert.equal(denied.error.code,'NOT_AUTHORIZED');pass('another client cannot read this booking');
s=await newVisit({...patch,allowedDates:[health.catalog.dates[2]]});prepared=await prepare(s,booking);await api('/api/demo',admin,{action:'occupy',optionId:prepared.optionId});const failedMove=await tool('reschedule_booking',{actionId:prepared.actionId,confirmationRef:prepared.confirmationRef},client,requestId,409);assert.equal(failedMove.error.code,'SLOT_CONFLICT');s=await api('/api/requests');assert.equal(s.bookings[0].snapshot.startAt,booking.snapshot.startAt);assert.equal(s.bookings[0].bookingVersion,1);pass('failed reschedule preserves the original booking');
s=await tool('find_options',{expectedRequestVersion:s.request.requestVersion});prepared=await prepare(s,booking);const moved=await tool('reschedule_booking',{actionId:prepared.actionId,confirmationRef:prepared.confirmationRef});assert.equal(moved.data.bookingId,booking.bookingId);assert.equal(moved.data.bookingVersion,2);assert.notEqual(moved.data.snapshot.startAt,booking.snapshot.startAt);pass('successful reschedule keeps the ID and increments the booking version');
const cancel=await tool('prepare_change',{changeType:'cancel',bookingId:booking.bookingId,expectedBookingVersion:2});const ev=await api('/api/evidence',client,{kind:'confirmation',actionId:cancel.data.actionId,source:'button'});const cancelled=await tool('cancel_booking',{actionId:cancel.data.actionId,confirmationRef:ev.confirmationRef});assert.equal(cancelled.data.status,'cancelled');assert.equal(cancelled.data.bookingVersion,3);pass('cancellation is persisted after separate confirmation');
const board=await api('/api/admin',admin);assert.equal(board.bookings[0].status,'cancelled');assert.ok(board.events.some(e=>e.type==='booking.cancelled'));pass('administrator sees the saved result and operation history');
await api('/api/demo',admin,{action:'reset'});assert.equal((await api('/api/requests')).bookings.length,0);pass('administrator reset clears only this isolated test namespace');
console.log(`Finished: ${checks} real route/PostgreSQL scenarios passed. Voice provider and microphone were not used.`);
