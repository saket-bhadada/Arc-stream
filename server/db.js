import pg from 'pg';
import dotenv from 'dotenv';

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

db.on('error',(err)=>{
    console.error('[DB] Unexpected error: ',err.message);
});

db.connect()
.then((client)=>{
    console.log('[DB] Connected');
    client.release();
})
.catch((err)=>{
    console.error('[DB] Failed to connect: ',err.message);
    process.exit(1);
});
export default db;