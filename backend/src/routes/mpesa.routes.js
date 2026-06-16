// src/routes/mpesa.routes.js
const express = require('express');
const router  = express.Router();
const mpesaController = require('../controllers/mpesa.controller');

// POST /api/v1/mpesa/stk-push
// Called by the frontend at checkout — initiates the STK push to the customer's phone
router.post('/stk-push', mpesaController.initiateSTKPush);

// GET /api/v1/mpesa/status/:checkoutRequestId
// Public lightweight poll — frontend calls this every 3s to check if payment landed
router.get('/status/:checkoutRequestId', mpesaController.checkStatus);

// POST /api/v1/mpesa/callback
// Called by Safaricom's servers after the customer enters their PIN.
// ⚠️ This route MUST be unauthenticated (no API key check) — Safaricom hits it directly.
// ⚠️ It must respond with HTTP 200 immediately, even on errors, or Safaricom will retry.
router.post('/callback', mpesaController.handleCallback);

// POST /api/v1/mpesa/manual-payment  (admin only)
// Mark an order as paid via bank transfer / cheque — triggers same downstream logic
router.post('/manual-payment', require('../middleware/adminAuth'), mpesaController.manualPayment);

module.exports = router;
