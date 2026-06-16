// src/routes/quotes.routes.js
const express   = require('express');
const router    = express.Router();
const ctrl      = require('../controllers/quotes.controller');
const adminAuth = require('../middleware/adminAuth');

// Public — customer submits from website
router.post('/', ctrl.createQuote);

// Admin only
router.get('/',                        adminAuth, ctrl.listQuotes);
router.get('/pipeline',                adminAuth, ctrl.pipeline);
router.get('/:id',                     adminAuth, ctrl.getQuote);
router.patch('/:id',                   adminAuth, ctrl.updateQuote);
router.post('/:id/send-payment-link',  adminAuth, ctrl.sendPaymentLink);

module.exports = router;
