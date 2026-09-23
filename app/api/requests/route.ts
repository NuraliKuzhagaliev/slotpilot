import { requireUser,sameOrigin } from '@/src/server/app/auth';
import { handle,json } from '@/src/server/app/http';
import { readState,mutate,config } from '@/src/server/app/db';
import { newRequest,snapshot } from '@/src/server/app/state';
export async function GET(req:Request){return handle(async()=>{const u=await requireUser(req);const {document}=await readState();return json(snapshot(document,u))})}
export async function POST(req:Request){return handle(async()=>{sameOrigin(req);const u=await requireUser(req);const r=await mutate(s=>newRequest(s,u,config().namespace));return json(snapshot(r.state,u))})}
