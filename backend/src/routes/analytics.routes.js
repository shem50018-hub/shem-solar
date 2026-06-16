// src/routes/analytics.routes.js
const express   = require('express');
const router    = express.Router();
const ctrl      = require('../controllers/analytics.controller');
const adminAuth = require('../middleware/adminAuth');

router.use(adminAuth);

router.get('/overview',      ctrl.overview);
router.get('/revenue',       ctrl.revenueByMonth);
router.get('/top-products',  ctrl.topProducts);

module.exports = router;
