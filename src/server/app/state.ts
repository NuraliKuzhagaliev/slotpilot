import type { AppState, User, Snapshot, Catalog } from '../../contracts/app.ts';
import type { BookingRequest, Dataset } from '../../contracts/domain.ts';
import { makeDemoDataset } from '../db/demo-fixtures.ts';
import { createDraft } from '../domain/requests.ts';
import { horizonDates, localParts } from '../domain/time.ts';
export function initialState(now:string):AppState{return {schemaVersion:1,generation:crypto.randomUUID(),seedAt:now,calendarRevision:1,requests:{},searches:{},comparisons:{},bookings:{},actions:{},evidence:{},logs:[],callbacks:{},parts:[],extraReservations:[],sessions:{}}}
export function catalogue(now:string):Catalog{const d=makeDemoDataset(now);return {services:d.services,vehicles:d.vehicles,branches:d.branches,dates:horizonDates(now),clock:localParts(now),demoData:true}}
export function dataset(state:AppState,now:string,ignoreBooking?:string):Dataset{
 const d=makeDemoDataset(now);d.calendarRevision=state.calendarRevision;d.parts=state.parts;
 d.reservations.push(...state.extraReservations);
 for(const b of Object.values(state.bookings)){if(b.status!=='confirmed'||b.bookingId===ignoreBooking)continue;for(const kind of ['technician','bay'] as const)d.reservations.push({id:`${b.bookingId}-${kind}`,resourceId:kind==='technician'?b.snapshot.technicianId:b.snapshot.bayId,resourceKind:kind,startAt:b.snapshot.startAt,endAt:b.snapshot.readyAt,status:'active'})}
 return d;
}
export function session(state:AppState,user:User){return state.sessions[user.userId]??={requestId:null,tokenTimes:[],toolCalls:{}}}
export function request(state:AppState,user:User):BookingRequest{const id=session(state,user).requestId;const r=id?state.requests[id]:null;if(!r||r.ownerId!==user.userId)throw Object.assign(new Error('Start a new visit first.'),{code:'STALE_REQUEST'});return r}
export function newRequest(state:AppState,user:User,namespace:string){const s=session(state,user);const r=createDraft(crypto.randomUUID(),user.userId,namespace);state.requests[r.requestId]=r;s.requestId=r.requestId;return r}
export function snapshot(state:AppState,user:User):Snapshot{const id=state.sessions[user.userId]?.requestId;return {request:id?state.requests[id]??null:null,search:id?state.searches[id]??null:null,comparison:id?state.comparisons[id]??null:null,bookings:Object.values(state.bookings).filter(b=>b.ownerId===user.userId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),events:state.logs.filter(l=>l.ownerId===user.userId).slice(-40),generation:state.generation,databaseConnected:true}}
export function log(state:AppState,user:User,type:string,now:string,id:string|null=null){state.logs.push({id:crypto.randomUUID(),at:now,type,requestId:id,ownerId:user.userId});state.logs=state.logs.slice(-400)}
