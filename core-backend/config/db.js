const mysql = require('mysql2/promise');
require('dotenv').config();

let dbName = process.env.DB_NAME || 'gift_ecommerce';
if (process.env.TEST_DB_NAME) {
    const testDb = process.env.TEST_DB_NAME.trim();
    if (!/^[a-z0-9_]+_test$/i.test(testDb)) {
        throw new Error(`TEST_DB_NAME must end with _test to ensure isolation (got "${testDb}")`);
    }
    dbName = testDb;
}

const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: dbName,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool;