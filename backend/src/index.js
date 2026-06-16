// src/index.js
require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const rateLimit    = require('express-rate-limit');

const errorHandler = require('./middleware/errorHandler');
const { startWorker } = require('./services/queue.service');

// ── Route imports ─────────────────────────────────────────────────────────────
const mpesaRoutes     = require('./routes/mpesa.routes');
const ordersRoutes    = require('./routes/orders.routes');
const productsRoutes  = require('./routes/products.routes');
const quotesRoutes    = require('./routes/quotes.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const portalRoutes    = require('./routes/portal.routes');

const app = express();

// ── Security & parsing ────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
}));
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Rate limiting ─────────────────────────────────────────────────────────────
// General API limit
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  message: { error: 'Too many requests, please try again later.' },
}));

// Tighter limit on the STK push endpoint (expensive Safaricom call)
app.use('/api/v1/mpesa/stk-push', rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 5,
  message: { error: 'Too many payment attempts. Please wait a minute and try again.' },
}));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), env: process.env.NODE_ENV });
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/v1/mpesa',     mpesaRoutes);
app.use('/api/v1/orders',    ordersRoutes);
app.use('/api/v1/products',  productsRoutes);
app.use('/api/v1/quotes',    quotesRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/portal',    portalRoutes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start server + BullMQ worker ──────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`\n🚀  Shem Solar API running on port ${PORT} [${process.env.NODE_ENV}]`);
  console.log(`    Health:   http://localhost:${PORT}/health`);
  console.log(`    Products: http://localhost:${PORT}/api/v1/products`);
  console.log(`    Callback: POST ${process.env.MPESA_CALLBACK_URL}\n`);
});

// Start the SMS BullMQ worker in the same process
// (In production with high load, run this as a separate process/dyno)
startWorker();

module.exports = app;
