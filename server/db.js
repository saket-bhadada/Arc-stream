import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const {Pool} = pg;

const REQUIRED =['DB_HOST','DB_PORT','DB_DATABASE','DB_USER','DB_PASSWORD']
const missing = REQUIRED.filter((key)=>!process.env[key]);
if(missing.length>0){
    throw new Error(
        `[DB] Missing environment variables: ${missing.join(', ')}
        check ./env file`
    );
}

const db = new pg.Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,

    max:                     parseInt(process.env.DB_MAX_CONNECTIONS, 10)      || 10,
    idleTimeoutMillis:       parseInt(process.env.DB_IDLE_TIMEOUT_MS, 10)      || 30_000,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10) || 5_000,
});
const initializeDatabase = async () => {
    try{
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);

        const sqlFilePath = path.join(__dirname,'../database/database_schema.sql');
        const sqlContent = fs.readFileSync(sqlFilePath,'utf-8');

        try {
            await db.query(sqlContent);
            console.log('[DB] Schema created/verified successfully (all tables)');
        } catch (err) {
            // pgvector not installed — skip vector-related SQL
            if (err.message.includes('vector')) {
                console.warn('[DB] ⚠ pgvector not available — skipping track_features table');
                const nonVectorSql = sqlContent
                    .replace(/create\s+extension\s+if\s+not\s+exists\s+vector\s*;/i, '')
                    .replace(/create\s+table\s+if\s+not\s+exists\s+track_features[\s\S]*?;\s*/i, '')
                    .replace(/create\s+index\s+if\s+not\s+exists\s+track_features_z_vector_idx[\s\S]*?;\s*/i, '');
                await db.query(nonVectorSql);
                console.log('[DB] Schema created/verified (without vector tables)');
            } else {
                throw err;
            }
        }
    }catch(err){
        console.error('[DB] Failed to create/verify schema: ',err.message);
    }
}
db.on('error',(err)=>{
    console.error('[DB] Unexpected error: ',err.message);
});

db.connect()
.then(async (client)=>{
    console.log('[DB] Connected');
    client.release();
    await initializeDatabase();
})
.catch((err)=>{
    console.error('[DB] Failed to connect: ',err.message);
    process.exit(1);
});
export default db;