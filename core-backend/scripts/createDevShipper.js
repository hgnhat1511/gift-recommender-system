require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

async function createDevShipper() {
    if (process.env.NODE_ENV === 'production') throw new Error('This script cannot run in production.');
    const fullName = (process.env.SHIPPER_NAME || '').trim();
    const email = (process.env.SHIPPER_EMAIL || '').trim().toLowerCase();
    const password = process.env.SHIPPER_PASSWORD || '';
    if (!fullName || fullName.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150 ||
        Buffer.byteLength(password, 'utf8') < 8 || Buffer.byteLength(password, 'utf8') > 72) {
        throw new Error('Set SHIPPER_NAME, SHIPPER_EMAIL, and an 8–72 byte SHIPPER_PASSWORD.');
    }

    const [[existing]] = await pool.execute('SELECT id,role FROM users WHERE email=? LIMIT 1', [email]);
    const passwordHash = await bcrypt.hash(password, 12);
    if (existing) {
        if (existing.role !== 'SHIPPER') throw new Error('The configured email belongs to a non-shipper account.');
        await pool.execute("UPDATE users SET full_name=?,password_hash=?,status='ACTIVE' WHERE id=?", [fullName, passwordHash, existing.id]);
        console.log(`Updated development shipper account: ${email}`);
        return;
    }
    await pool.execute("INSERT INTO users (full_name,email,password_hash,role,status) VALUES (?,?,?,'SHIPPER','ACTIVE')", [fullName, email, passwordHash]);
    console.log(`Created development shipper account: ${email}`);
}

createDevShipper().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
}).finally(async () => pool.end());
