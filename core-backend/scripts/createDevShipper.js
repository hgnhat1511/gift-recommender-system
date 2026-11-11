'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');

const REQUIRED_TEST_DB = 'giftly_e2e_test';

function assertSafeTarget() {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('This development-only script cannot run in production.');
    }
    if ((process.env.DB_NAME || '').trim() !== REQUIRED_TEST_DB ||
        (process.env.TEST_DB_NAME || '').trim() !== REQUIRED_TEST_DB) {
        throw new Error(`Set both DB_NAME and TEST_DB_NAME to ${REQUIRED_TEST_DB}; refusing to write to any other database.`);
    }
}

async function createDevShipper() {
    assertSafeTarget();

    const fullName = (process.env.SHIPPER_NAME || '').trim();
    const email = (process.env.SHIPPER_EMAIL || '').trim().toLowerCase();
    const password = process.env.SHIPPER_PASSWORD || '';
    if (!fullName || fullName.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150 ||
        Buffer.byteLength(password, 'utf8') < 8 || Buffer.byteLength(password, 'utf8') > 72) {
        throw new Error('Set SHIPPER_NAME, SHIPPER_EMAIL, and an 8–72 byte SHIPPER_PASSWORD.');
    }

    const pool = require('../config/db');
    try {
        const [[database]] = await pool.query('SELECT DATABASE() name');
        if (database.name !== REQUIRED_TEST_DB) {
            throw new Error(`Connected to ${database.name}; refusing to write to a database other than ${REQUIRED_TEST_DB}.`);
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
    } finally {
        await pool.end();
    }
}

createDevShipper().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
