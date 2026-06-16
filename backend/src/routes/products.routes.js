// src/routes/products.routes.js
const express   = require('express');
const router    = express.Router();
const ctrl      = require('../controllers/products.controller');
const adminAuth = require('../middleware/adminAuth');

// Public
router.get('/',          ctrl.listProducts);
router.get('/packages',  ctrl.listPackages);
router.get('/:slug',     ctrl.getProduct);

// Admin
router.post('/',                adminAuth, ctrl.createProduct);
router.patch('/:id',            adminAuth, ctrl.updateProduct);
router.patch('/:id/stock',      adminAuth, ctrl.restockProduct);

module.exports = router;
