const express = require('express');
const cors = require('cors');
require('dotenv').config();

const pool = require('./config/db');
const redisClient = require('./config/redis');
const authRoutes = require('./routes/authRoutes');
const catalogRoutes = require('./routes/catalogRoutes');
const cartRoutes = require('./routes/cartRoutes');
const accountRoutes = require('./routes/accountRoutes');
const orderRoutes = require('./routes/orderRoutes');
const adminRoutes = require('./routes/adminRoutes');
const reviewRoutes = require('./routes/reviewRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',').map((origin) => origin.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '10kb' }));
app.use('/api/auth', authRoutes);
app.use('/api/products', catalogRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reviews', reviewRoutes);

// Kiem tra Backend
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Gift Recommender API is running!'
    });
});

// Kiem tra MySQL
app.get('/api/health/mysql', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT 1 AS result');

        res.json({
            success: true,
            message: 'MySQL connected successfully',
            data: rows[0]
        });
    } catch (error) {
        console.error('MySQL error:', error.message);

        res.status(500).json({
            success: false,
            message: 'Cannot connect to MySQL'
        });
    }
});

// Kiem tra Redis
app.get('/api/health/redis', async (req, res) => {
    try {
        if (!redisClient.isReady) {
            return res.status(503).json({
                success: false,
                message: 'Redis is not ready'
            });
        }

        const result = await redisClient.ping();

        res.json({
            success: true,
            message: 'Redis connected successfully',
            data: result
        });
    } catch (error) {
        console.error('Redis error:', error.message);

        res.status(500).json({
            success: false,
            message: 'Cannot connect to Redis'
        });
    }
});

app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.parse.failed') {
        return res.status(400).json({ success: false, message: 'Invalid JSON request body' });
    }
    console.error('Request failed:', error.code || error.name || 'unexpected error');
    return res.status(500).json({ success: false, message: 'Internal server error' });
});

async function startServer() {
    try {
        if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32) {
            throw new Error('JWT_SECRET must contain at least 32 bytes');
        }
        // Kiem tra MySQL
        const connection = await pool.getConnection();
        console.log('MySQL connected successfully!');
        connection.release();

        // Ket noi Redis
        if (!redisClient.isOpen) {
            await redisClient.connect();
        }

        console.log('Redis connected successfully!');

        app.listen(PORT, () => {
            console.log(`Backend running at http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('Startup failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) startServer();

module.exports = { app, startServer };
