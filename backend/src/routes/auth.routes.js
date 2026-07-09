const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/auth.controller');
const jwt = require('jsonwebtoken');
const adminAuth = require('../middleware/adminAuth'); // 👈 Added this line

// Middleware to verify JWT token
function verifyToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
    try {
        req.admin = jwt.verify(token, process.env.JWT_SECRET || process.env.ADMIN_SECRET);
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

router.post('/register', ctrl.register);
router.post('/login', ctrl.login);
router.get('/me', verifyToken, ctrl.me);
router.post('/create-admin', adminAuth, ctrl.createAdmin);

module.exports = router;