// Integration of real HTTP route handlers and Supabase. Optional local HTTP transport.
import {registerHooks} from "node:module";
import {resolve} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
if(existsSync('.env.local')) process.loadEnvFile('.env.local');
const inProcess=!process.env.SLOTPILOT_TEST_BASE_URL;
const origin=process.env.SLOTPILOT_TEST_BASE_URL||'http://localhost:3000';
const root=fileURLToPath(new URL('../',import.meta.url));
if(inProcess)registerHooks({resolve(specifier,context,next){if(specifier.startsWith('@/')){const file=resolve(root,specifier.slice(2));return next(pathToFileURL(existsSync(file)?file:file+'.ts').href,context)}return next(specifier,context)}});
console.log(inProcess?'Mode: actual route handlers in process; real Supabase/PostgreSQL.':'Mode: local HTTP server; real Supabase/PostgreSQL.');
assert.ok(['127.0.0.1','localhost','terminal.local'].includes(new URL(origin).hostname),'Only run against a local server.');
assert.match(process.env.DEMO_NAMESPACE||'',/^slotpilot-test-/,'Use an isolated test namespace in both the server and this process.');
const client={cookie:''},other={cookie:''},admin={cookie:''};
let checks=0;
function pass(s){checks++;console.log('PASS: '+s)}
async function api(path,actor=client,payload,expected=200){const request=new Request(origin+path,{method:payload===undefined?'GET':'POST',headers:{Origin:origin,...(actor.cookie?{Cookie:actor.cookie}:{}),...(payload!==undefined?{'Content-Type':'application/json'}:{})},...(payload!==undefined?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(45000)});const res=inProcess?await (await import(pathToFileURL(resolve(root,'app'+path+'/route.ts')).href))[request.method](request):await fetch(request);const body=await res.json();assert.equal(res.status,expected,`${path}: ${body.error?.code||'Unexpected response'}`);const cookie=res.headers.get('set-cookie');if(cookie)actor.cookie=cookie.split(';')[0];return body}
async function login(actor,role){await api('/api/session',actor,{role,password:process.env[role==='admin'?'DEMO_ADMIN_PASSWORD':'DEMO_CLIENT_PASSWORD']})}
let requestId;
async function tool(name,args,actor=client,id=requestId,expected=200){return api('/api/tools',actor,{name,arguments:args,callId:crypto.randomUUID(),requestId:id},expected)}
async function newVisit(patch){let s=await api('/api/requests',client,{});requestId=s.request.requestId;s=await tool('update_request',{patch,expectedRequestVersion:s.request.requestVersion});return tool('find_options',{expectedRequestVersion:s.request.requestVersion})}
async function prepare(s,booking){const o=s.request.options[0];assert.ok(o);const a=await tool(booking?'prepare_change':'prepare_booking',booking?{changeType:'reschedule',bookingId:booking.bookingId,expectedBookingVersion:booking.bookingVersion,optionId:o.optionId,expectedRequestVersion:s.request.requestVersion}:{optionId:o.optionId,expectedRequestVersion:s.request.requestVersion});const ev=await api('/api/evidence',client,{kind:'confirmation',actionId:a.data.actionId,source:'button'});return {actionId:a.data.actionId,confirmationRef:ev.confirmationRef,optionId:o.optionId}}
const health=await api('/api/health');assert.equal(health.databaseConfigured,true);assert.equal(health.authConfigured,true);pass('runtime sees the real database and server authentication');
await login(client,'client');await login(other,'client');await login(admin,'admin');
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
