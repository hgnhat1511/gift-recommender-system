require('dotenv').config();
const pool=require('../config/db');

async function promote(){
    const email=process.argv[2]?.trim().toLowerCase();
    if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Pass the email address of an already registered account.');
    const connection=await pool.getConnection();
    try{
        await connection.beginTransaction();
        const [rows]=await connection.execute('SELECT id,status FROM users WHERE email=? FOR UPDATE',[email]);
        if(!rows[0])throw new Error('No account was found for that email. Register the account first.');
        if(rows[0].status!=='ACTIVE')throw new Error('Only an active account can be promoted.');
        await connection.execute("UPDATE users SET role='ADMIN' WHERE id=?",[rows[0].id]);
        await connection.execute("INSERT INTO admin_audit_logs (admin_id,action,entity_type,entity_id,details) VALUES (?, 'ADMIN_BOOTSTRAP','user',?,JSON_OBJECT('source','local CLI'))",[rows[0].id,rows[0].id]);
        await connection.commit();
        console.log('Account promoted to ADMIN. Sign in again to refresh the role claim.');
    }catch(error){await connection.rollback();throw error}finally{connection.release();await pool.end()}
}
promote().catch((error)=>{console.error('Admin bootstrap failed:',error.message);process.exitCode=1});
