import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const p=new URL('../.env.local',import.meta.url);let content=existsSync(p)?readFileSync(p,'utf8'):'';
const defaults={ASSEMBLYAI_API_KEY:'',SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',SUPABASE_SERVICE_ROLE_KEY:'',SESSION_SECRET:randomBytes(48).toString('hex'),DEMO_CLIENT_PASSWORD:randomBytes(18).toString('base64url'),DEMO_ADMIN_PASSWORD:randomBytes(18).toString('base64url'),DEMO_NAMESPACE:'slotpilot-demo',VOICE_MAX_SESSION_SECONDS:'300',VOICE_DAILY_TOKEN_LIMIT:'10'};
for(const [k,v]of Object.entries(defaults))if(!new RegExp(`^${k}=`, 'm').test(content))content+=`${content.endsWith('\n')||!content?'':'\n'}${k}=${v}\n`;
writeFileSync(p,content,{mode:0o600});console.log('Server configuration is ready in .env.local. Existing values were preserved. Add your AssemblyAI key and Supabase server settings there; never send this file in chat.');
