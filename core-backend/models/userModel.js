const pool = require('../config/db');

async function findByEmail(email) {
    const [rows] = await pool.execute(
        'SELECT id, full_name, email, password_hash, role, status, created_at FROM users WHERE email = ? LIMIT 1',
        [email]
    );
    return rows[0] || null;
}

async function findPublicById(id) {
    const [rows] = await pool.execute(
        'SELECT id, full_name, email, role, status, created_at FROM users WHERE id = ? LIMIT 1',
        [id]
    );
    return rows[0] || null;
}

async function create({ fullName, email, passwordHash }) {
    const [result] = await pool.execute(
        "INSERT INTO users (full_name, email, password_hash, role, status) VALUES (?, ?, ?, 'USER', 'ACTIVE')",
        [fullName, email, passwordHash]
    );
    return findPublicById(result.insertId);
}

module.exports = { findByEmail, findPublicById, create };
