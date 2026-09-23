import { body,handle,json } from '@/src/server/app/http';
import { CustomerConstraintsSchema } from '@/src/contracts/domain';
import { createDraft } from '@/src/server/domain/requests';
import { findOptions } from '@/src/server/domain/scheduler';
import { makeDemoDataset } from '@/src/server/db/demo-fixtures';
export async function POST(req:Request){return handle(async()=>{const c=CustomerConstraintsSchema.parse(await body(req));const now=new Date().toISOString();const r=createDraft('preview','preview','slotpilot-preview');r.constraints=c;return json({...findOptions(r,makeDemoDataset(now),{now,nextOptionId:()=>crypto.randomUUID()}),previewOnly:true,databaseConnected:false})})}
