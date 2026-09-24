import { dbConfigured } from '@/src/server/app/db';
import { catalogue } from '@/src/server/app/state';
import { json } from '@/src/server/app/http';
import { authConfigured } from '@/src/server/app/auth';
export async function GET(){return json({databaseConfigured:dbConfigured(),voiceConfigured:Boolean(process.env.ASSEMBLYAI_API_KEY),authConfigured:authConfigured(),catalog:catalogue(new Date().toISOString())})}
