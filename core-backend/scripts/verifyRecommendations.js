/**
 * verifyRecommendations.js
 * Kiểm tra gợi ý cho 3 tài khoản demo và 3 khách thường.
 * Đo độ trễ API gợi ý trên catalog 1.000 sản phẩm: 500 lượt tuần tự, trung vị 3 lần.
 */
'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');

const API_BASE = 'http://localhost:5000/api';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_this_before_production_2026';

function signToken(userId, role = 'USER', mlUserId = null) {
    return jwt.sign(
        {},
        JWT_SECRET,
        {
            algorithm: 'HS256',
            subject: String(userId),
            issuer: 'giftly-api',
            audience: 'giftly-client',
            expiresIn: '1h'
        }
    );
}

async function getRecommendations(token = null, limit = 8) {
    const headers = { 'content-type': 'application/json' };
    if (token) headers['authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/products/recommendations?limit=${limit}`, { headers });
    if (!res.ok) {
        throw new Error(`HTTP error ${res.status}: ${await res.text()}`);
    }
    return res.json();
}

function computeStats(times) {
    times.sort((a, b) => a - b);
    const min = times[0];
    const max = times[times.length - 1];
    const avg = times.reduce((s, x) => s + x, 0) / times.length;
    const median = times[Math.floor(times.length / 2)];
    const p95 = times[Math.floor(times.length * 0.95)];
    const p99 = times[Math.floor(times.length * 0.99)];
    return { min, max, avg: Math.round(avg * 100) / 100, median, p95, p99 };
}

async function main() {
    console.log('=== BƯỚC 5: KIỂM TRA GỢI Ý VÀ ĐO ĐỘ TRỄ ===\n');

    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD,
        database: 'gift_ecommerce'
    });

    try {
        // 1. Kiểm tra 3 tài khoản Demo REES46
        const [demoUsers] = await conn.execute(
            'SELECT id, full_name, email, ml_user_id FROM users WHERE ml_user_id IS NOT NULL ORDER BY id LIMIT 3'
        );
        console.log(`--- 1. Kiểm tra 3 tài khoản Demo (Yêu cầu: nguồn ranker_lc1 hoặc popularity_fallback, không rỗng) ---`);
        for (const u of demoUsers) {
            const token = signToken(u.id, 'USER', u.ml_user_id);
            const res = await getRecommendations(token, 8);
            const data = res.data;
            console.log(`User ID: ${u.id} | Email: ${u.email} | ml_user_id: ${u.ml_user_id}`);
            console.log(`  -> Source: ${data.source} | Method: ${data.method} | Số sản phẩm: ${data.items.length}`);
            if (data.items.length > 0) {
                const sample = data.items[0];
                console.log(`  -> Sản phẩm top 1: #${sample.id} "${sample.name}" (Score: ${sample.reasons?.join(', ') || 'N/A'})`);
            }
            if (!data.items || data.items.length === 0) {
                throw new Error(`LỖI: Tài khoản demo ${u.email} trả về danh sách rỗng!`);
            }
        }

        // 2. Kiểm tra 3 khách thường
        const [regUsers] = await conn.execute(
            'SELECT id, full_name, email FROM users WHERE ml_user_id IS NULL AND role = "USER" ORDER BY id LIMIT 2'
        );
        console.log(`\n--- 2. Kiểm tra 3 khách thường (Yêu cầu: nguồn fallback/baseline, không rỗng, không chứa sản phẩm synthetic) ---`);
        
        // Khách thường 1 & 2
        for (const u of regUsers) {
            const token = signToken(u.id, 'USER', null);
            const res = await getRecommendations(token, 8);
            const data = res.data;
            const hasSynthetic = data.items.some(p => p.isSyntheticDisplay);
            console.log(`User ID: ${u.id} | Email: ${u.email}`);
            console.log(`  -> Source: ${data.source} | Method: ${data.method} | Số sản phẩm: ${data.items.length} | Có synthetic: ${hasSynthetic}`);
            if (data.items.length > 0) {
                console.log(`  -> Top 1: #${data.items[0].id} "${data.items[0].name}"`);
            }
            if (!data.items || data.items.length === 0) {
                throw new Error(`LỖI: Khách thường ${u.email} trả về danh sách rỗng!`);
            }
            if (hasSynthetic) {
                throw new Error(`LỖI BẢO VỆ: Khách thường ${u.email} bị lộ sản phẩm synthetic!`);
            }
        }

        // Khách vãng lai (Guest, token = null)
        const guestRes = await getRecommendations(null, 8);
        const guestData = guestRes.data;
        const guestHasSynthetic = guestData.items.some(p => p.isSyntheticDisplay);
        console.log(`Khách vãng lai (Guest - Không đăng nhập)`);
        console.log(`  -> Source: ${guestData.source} | Method: ${guestData.method} | Số sản phẩm: ${guestData.items.length} | Có synthetic: ${guestHasSynthetic}`);
        if (guestData.items.length > 0) {
            console.log(`  -> Top 1: #${guestData.items[0].id} "${guestData.items[0].name}"`);
        }
        if (!guestData.items || guestData.items.length === 0) {
            throw new Error(`LỖI: Khách vãng lai trả về danh sách rỗng!`);
        }
        if (guestHasSynthetic) {
            throw new Error(`LỖI BẢO VỆ: Khách vãng lai bị lộ sản phẩm synthetic!`);
        }

        // 3. Đo độ trễ API gợi ý trên catalog 1.000 sản phẩm: 500 lượt tuần tự, 3 lần chạy
        console.log(`\n--- 3. Đo độ trễ API gợi ý (500 lượt tuần tự x 3 lần chạy) ---`);
        const demoUser = demoUsers[0];
        const demoToken = signToken(demoUser.id, 'USER', demoUser.ml_user_id);
        const RUNS = 3;
        const REQUESTS_PER_RUN = 500;
        const runMedians = [];
        const runResults = [];

        for (let run = 1; run <= RUNS; run++) {
            console.log(`Bắt đầu Lần chạy ${run}/${RUNS} (500 requests)...`);
            const latencies = [];
            const startTime = Date.now();

            for (let reqIdx = 1; reqIdx <= REQUESTS_PER_RUN; reqIdx++) {
                const t0 = performance.now();
                await getRecommendations(demoToken, 8);
                const t1 = performance.now();
                latencies.push(t1 - t0);
                if (reqIdx % 100 === 0) {
                    process.stdout.write(`  [Lần ${run}] Đã xong ${reqIdx}/500 requests...\r`);
                }
            }
            const totalWallTime = (Date.now() - startTime) / 1000;
            const stats = computeStats(latencies);
            runMedians.push(stats.median);
            runResults.push(stats);
            console.log(`\nKết quả Lần chạy ${run}: Min=${stats.min.toFixed(1)}ms | Median=${stats.median.toFixed(1)}ms | Avg=${stats.avg.toFixed(1)}ms | P95=${stats.p95.toFixed(1)}ms | P99=${stats.p99.toFixed(1)}ms | Tổng thời gian=${totalWallTime.toFixed(1)}s`);
        }

        runMedians.sort((a, b) => a - b);
        const finalMedian = runMedians[1]; // Trung vị của 3 lần chạy
        console.log(`\n========================================`);
        console.log(`TỔNG HỢP ĐỘ TRỄ 3 LẦN CHẠY (500 reqs/lần):`);
        console.log(`- Lần 1 Median: ${runResults[0].median.toFixed(2)} ms`);
        console.log(`- Lần 2 Median: ${runResults[1].median.toFixed(2)} ms`);
        console.log(`- Lần 3 Median: ${runResults[2].median.toFixed(2)} ms`);
        console.log(`-> TRUNG VỊ 3 LẦN CHẠY: ${finalMedian.toFixed(2)} ms`);
        console.log(`========================================\n`);

    } finally {
        await conn.end();
    }
}

main().catch(err => {
    console.error('LỖI KIỂM TRA GỢI Ý:', err);
    process.exit(1);
});
