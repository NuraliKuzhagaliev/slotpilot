import { requireUser,requireAdmin } from '@/src/server/app/auth';
import { handle,json } from '@/src/server/app/http';
import { readState } from '@/src/server/app/db';
export async function GET(req:Request){return handle(async()=>{const u=await requireUser(req);requireAdmin(u);const {document:s}=await readState();return json({bookings:Object.values(s.bookings),callbacks:Object.values(s.callbacks),events:s.logs,options:Object.values(s.requests).flatMap(r=>r.options).filter(o=>Date.parse(o.expiresAt)>Date.now()),parts:s.parts,generation:s.generation})})}
