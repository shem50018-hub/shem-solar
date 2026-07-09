// src/routes/orders.routes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/orders.controller');
const adminAuth = require('../middleware/adminAuth');

// All order routes are admin-only
router.use(adminAuth);

router.get('/', ctrl.listOrders);
router.get('/:id', ctrl.getOrder);
router.patch('/:id/status', ctrl.updateStatus);
router.post('/:id/sms', ctrl.sendQuickSMS);
router.delete('/:id', adminAuth, ctrl.deleteOrder);

module.exports = router;
