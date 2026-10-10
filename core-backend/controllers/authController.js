const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');

const publicUser = (user) => ({
    id: String(user.id), fullName: user.full_name, email: user.email,
    role: user.role, status: user.status, createdAt: user.created_at
});

function validateEmail(email) {
    return typeof email === 'string' && email.length <= 150 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function issueToken(user) {
    return jwt.sign({}, process.env.JWT_SECRET, {
        algorithm: 'HS256', subject: String(user.id), expiresIn: process.env.JWT_EXPIRES_IN || '1h',
        issuer: 'giftly-api', audience: 'giftly-client'
    });
}

async function register(req, res, next) {
    try {
        const { fullName, email, password, confirmPassword } = req.body || {};
        if (typeof fullName !== 'string' || !fullName.trim() || fullName.trim().length > 100 || !validateEmail(email) ||
            typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
            return res.status(400).json({ success: false, message: 'Please provide a valid name, email, and password (8–72 bytes).' });
        }
        if (confirmPassword !== undefined && password !== confirmPassword) {
            return res.status(400).json({ success: false, message: 'Password confirmation does not match.' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        if (await userModel.findByEmail(normalizedEmail)) {
            return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
        }
        const passwordHash = await bcrypt.hash(password, 12);
        const user = await userModel.create({ fullName: fullName.trim(), email: normalizedEmail, passwordHash });
        return res.status(201).json({ success: true, message: 'Account created. Please sign in.', data: { user: publicUser(user) } });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
        }
        return next(error);
    }
}

async function login(req, res, next) {
    try {
        const { email, password } = req.body || {};
        if (!validateEmail(email) || typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) {
            return res.status(400).json({ success: false, message: 'Please provide a valid email and password.' });
        }
        const user = await userModel.findByEmail(email.trim().toLowerCase());
        if (!user || user.status !== 'ACTIVE' || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ success: false, message: 'Invalid email or password.' });
        }
        return res.json({ success: true, data: { token: issueToken(user), user: publicUser(user) } });
    } catch (error) {
        return next(error);
    }
}

function me(req, res) {
    return res.json({ success: true, data: { user: publicUser(req.user) } });
}

function logout(req, res) {
    return res.json({ success: true, message: 'Signed out. Remove the token from the client.' });
}

module.exports = { register, login, me, logout };
