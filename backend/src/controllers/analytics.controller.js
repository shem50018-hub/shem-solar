// src/controllers/analytics.controller.js
const pool = require('../db/pool');

// ── GET /api/v1/analytics/overview ───────────────────────────────────────────
exports.overview = async (req, res, next) => {
  try {
    const [revenue, orders, quotes, lowStock] = await Promise.all([
      pool.query(`
        SELECT COALESCE(SUM(total_amount),0) AS total_revenue
        FROM orders
        WHERE payment_status='completed'
          AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE order_status != 'cancelled') AS total,
          COUNT(*) FILTER (WHERE payment_status='completed')  AS paid,
          COUNT(*) FILTER (WHERE order_status='pending')      AS pending,
          COUNT(*) FILTER (WHERE order_status='cancelled')    AS cancelled
        FROM orders
        WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
      `),
      pool.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status='new') AS new_count
        FROM consultation_requests
        WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
      `),
      pool.query(`
        SELECT COUNT(*) AS count FROM products WHERE stock_quantity <= 3 AND is_active=true
      `),
    ]);

    res.json({
      revenue:       revenue.rows[0],
      orders:        orders.rows[0],
      quotes:        quotes.rows[0],
      low_stock:     lowStock.rows[0],
    });
  } catch (err) { next(err); }
};

// ── GET /api/v1/analytics/revenue ─────────────────────────────────────────────
// Monthly revenue for the past 6 months
exports.revenueByMonth = async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YYYY') AS month,
        COALESCE(SUM(total_amount), 0)                       AS revenue,
        COUNT(*)                                              AS order_count
      FROM orders
      WHERE payment_status = 'completed'
        AND created_at >= NOW() - INTERVAL '6 months'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at)
    `);
    res.json({ data: rows });
  } catch (err) { next(err); }
};

// ── GET /api/v1/analytics/top-products ────────────────────────────────────────
exports.topProducts = async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COALESCE(p.name, ip.name) AS product_name,
        SUM(oi.quantity)          AS units_sold,
        SUM(oi.price_at_purchase * oi.quantity) AS revenue
      FROM order_items oi
      LEFT JOIN products p              ON p.id  = oi.product_id
      LEFT JOIN installation_packages ip ON ip.id = oi.package_id
      JOIN orders o ON o.id = oi.order_id AND o.payment_status = 'completed'
      GROUP BY COALESCE(p.name, ip.name)
      ORDER BY revenue DESC
      LIMIT 5
    `);
    res.json({ data: rows });
  } catch (err) { next(err); }
};
