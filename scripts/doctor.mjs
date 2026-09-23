import { supabaseHeaders } from '../src/server/app/supabase-headers.mjs';
import { existsSync } from 'node:fs';
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const dbKey=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
const status={node:process.version,assemblyKeyConfigured:Boolean(process.env.ASSEMBLYAI_API_KEY),supabaseConfigured:Boolean(process.env.SUPABASE_URL&&dbKey),sessionSecretConfigured:(process.env.SESSION_SECRET?.length??0)>=32,clientPasswordConfigured:(process.env.DEMO_CLIENT_PASSWORD?.length??0)>=12,adminPasswordConfigured:(process.env.DEMO_ADMIN_PASSWORD?.length??0)>=12,databaseVerified:false,liveVoiceVerified:false};
if(status.supabaseConfigured){try{const r=await fetch(process.env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/slotpilot_state?select=namespace&limit=0',{headers:supabaseHeaders(dbKey),signal:AbortSignal.timeout(10000)});status.databaseVerified=r.ok;if(!r.ok)status.databaseNote='Check database migration and server credentials.'}catch{status.databaseNote='Database could not be reached.'}}
console.log(JSON.stringify(status,null,2));console.log('Configuration checks do not verify the microphone or voice latency.');
