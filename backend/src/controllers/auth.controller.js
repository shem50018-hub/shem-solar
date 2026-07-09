// src/controllers/auth.controller.js
const pool = require('../db/pool');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_SECRET;

// POST /api/v1/auth/register
// First-time setup or invite-only admin registration
exports.register = async (req, res, next) => {
    try {
        const { username, email, password, name, role, setup_key } = req.body;

        // Require setup key to prevent open registration
        if (setup_key !== process.env.ADMIN_SECRET) {
            return res.status(401).json({ error: 'Invalid setup key' });
        }

        if (!username || !email || !password || !name) {
            return res.status(400).json({ error: 'username, email, password and name are required' });
        }

        const password_hash = await bcrypt.hash(password, 12);

        const { rows } = await pool.query(
            `INSERT INTO admin_users (username, email, password_hash, name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, name, role, created_at`,
            [username, email, password_hash, name, role || 'staff']
        );

        res.status(201).json({ data: rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'Username or email already exists' });
        }
        next(err);
    }
};

// POST /api/v1/auth/login
exports.login = async (req, res, next) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'username and password are required' });
        }

        const { rows } = await pool.query(
            `SELECT * FROM admin_users WHERE username = $1 AND is_active = true`,
            [username]
        );

        const user = rows[0];
        if (!user) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, name: user.name },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            token,
            user: { id: user.id, username: user.username, name: user.name, role: user.role }
        });
    } catch (err) {
        next(err);
    }
};

// GET /api/v1/auth/me
exports.me = async (req, res) => {
    res.json({ data: req.admin });
};
// POST /api/v1/auth/create-admin (super_admin only, requires login)
exports.createAdmin = async (req, res, next) => {
    try {
        if (req.admin?.role !== 'super_admin') {
            return res.status(403).json({ error: 'Only super_admin can create new admin accounts' });
        }

        const { username, email, password, name, role } = req.body;
        if (!username || !email || !password || !name) {
            return res.status(400).json({ error: 'username, email, password and name are required' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        const password_hash = await bcrypt.hash(password, 12);

        const { rows } = await pool.query(
            `INSERT INTO admin_users (username, email, password_hash, name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, name, role, created_at`,
            [username, email, password_hash, name, role || 'staff']
        );

        res.status(201).json({ data: rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'Username or email already exists' });
        }
        next(err);
    }
};