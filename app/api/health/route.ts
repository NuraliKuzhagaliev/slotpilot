import { dbConfigured } from '@/src/server/app/db';
import { catalogue } from '@/src/server/app/state';
import { json } from '@/src/server/app/http';
export async function GET(){return json({databaseConfigured:dbConfigured(),voiceConfigured:Boolean(process.env.ASSEMBLYAI_API_KEY),authConfigured:Boolean(process.env.SESSION_SECRET&&process.env.DEMO_CLIENT_PASSWORD&&process.env.DEMO_ADMIN_PASSWORD),catalog:catalogue(new Date().toISOString())})}
