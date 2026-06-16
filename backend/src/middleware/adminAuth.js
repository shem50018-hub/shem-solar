// src/middleware/adminAuth.js
// Simple secret-header auth for admin routes.
// In production, replace with JWT or session-based auth.

module.exports = function adminAuth(req, res, next) {
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  next();
};
