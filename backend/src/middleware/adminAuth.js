// src/middleware/adminAuth.js
const jwt = require('jsonwebtoken');

module.exports = function adminAuth(req, res, next) {
  // Accept legacy x-admin-secret header
  const secret = req.headers['x-admin-secret'];
  if (secret && secret === process.env.ADMIN_SECRET) {
    return next();
  }

  // Accept JWT Bearer token
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || process.env.ADMIN_SECRET);
      req.admin = decoded;
      return next();
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  return res.status(401).json({ error: 'Unauthorised' });
};
