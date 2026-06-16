// src/controllers/portal.controller.js
// Read-only endpoints for the customer portal.
// Auth: x-portal-token header (separate from admin secret — lower privilege).
// Customers identify themselves by phone number + optional order reference.

const pool = require('../db/pool');

// ── GET /api/v1/portal/orders?phone=&order= ───────────────────────────────────
// Returns all orders matching the customer's phone number.
// The frontend uses this on login to identify the customer and load their history.
exports.getOrdersByPhone = async (req, res, next) => {
  try {
    const { phone, order } = req.query;
    if (!phone) return res.status(400).json({ error: 'phone is required' });

    // Normalise: accept 0712..., +254712..., 254712...
    const digits = phone.replace(/\D/g, '');
    const last9  = digits.slice(-9); // last 9 digits — matches any format

    const conditions = [`RIGHT(REPLACE(REPLACE(customer_phone,'+',''),' ',''), 9) = $1`];
    const params     = [last9];

    if (order) {
      params.push(order.toUpperCase());
      conditions.push(`order_number = $${params.length}`);
    }

    const { rows: orders } = await pool.query(`
      SELECT
        o.id, o.order_number, o.customer_name, o.customer_phone,
        o.customer_email, o.shipping_address, o.total_amount,
        o.order_status, o.payment_status, o.mpesa_receipt_number,
        o.created_at,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'product_name',  COALESCE(p.name, ip.name),
            'quantity',      oi.quantity,
            'price',         oi.price_at_purchase
          )
        ) AS items
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p              ON p.id  = oi.product_id
      LEFT JOIN installation_packages ip ON ip.id = oi.package_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `, params);

    if (!orders.length) {
      return res.status(404).json({ error: 'No orders found for this phone number' });
    }

    res.json({ orders });
  } catch (err) { next(err); }
};

// ── GET /api/v1/portal/orders/:id ─────────────────────────────────────────────
// Single order detail — customer must provide matching phone to prove ownership
exports.getOrderDetail = async (req, res, next) => {
  try {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: 'phone is required' });

    const digits = phone.replace(/\D/g, '');
    const last9  = digits.slice(-9);

    const { rows: [order] } = await pool.query(`
      SELECT
        o.*,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'product_name',  COALESCE(p.name, ip.name),
            'sku',           p.sku,
            'quantity',      oi.quantity,
            'price',         oi.price_at_purchase
          )
        ) AS items
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p              ON p.id  = oi.product_id
      LEFT JOIN installation_packages ip ON ip.id = oi.package_id
      WHERE o.id = $1
        AND RIGHT(REPLACE(REPLACE(o.customer_phone,'+',''),' ',''), 9) = $2
      GROUP BY o.id
    `, [req.params.id, last9]);

    if (!order) return res.status(404).json({ error: 'Order not found or phone does not match' });
    res.json(order);
  } catch (err) { next(err); }
};
