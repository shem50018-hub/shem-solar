// src/routes/portal.routes.js
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/portal.controller');

// Portal auth — separate lower-privilege token from admin secret
function portalAuth(req, res, next) {
  const token = req.headers['x-portal-token'];
  // Accept either the dedicated portal token OR the admin secret (admin can always access)
  if (
    token === process.env.PORTAL_TOKEN ||
    req.headers['x-admin-secret'] === process.env.ADMIN_SECRET
  ) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorised' });
}

router.use(portalAuth);

// GET /api/v1/portal/orders?phone=0712345678&order=SOLAR-2026-XXXX
router.get('/orders',     ctrl.getOrdersByPhone);

// GET /api/v1/portal/orders/:id?phone=0712345678
router.get('/orders/:id', ctrl.getOrderDetail);

module.exports = router;
