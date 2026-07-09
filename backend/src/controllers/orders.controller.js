// src/controllers/orders.controller.js
const pool = require('../db/pool');
const queue = require('../services/queue.service');

// ── GET /api/v1/orders ────────────────────────────────────────────────────────
// Admin: paginated list with optional filters
exports.listOrders = async (req, res, next) => {
  try {
    const {
      status, payment_status, search,
      page = 1, limit = 20,
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];

    if (status) {
      params.push(status);
      conditions.push(`o.order_status = $${params.length}`);
    }
    if (payment_status) {
      params.push(payment_status);
      conditions.push(`o.payment_status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(
        `(o.customer_name ILIKE $${params.length} OR o.order_number ILIKE $${params.length} OR o.customer_phone ILIKE $${params.length})`
      );
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(`
      SELECT
        o.id, o.order_number, o.customer_name, o.customer_phone,
        o.customer_email, o.total_amount, o.order_status, o.payment_status,
        o.mpesa_receipt_number, o.manual_payment_method, o.created_at,
        COUNT(oi.id) AS item_count
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      ${where}
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, parseInt(limit), offset]);

    const { rows: [{ count }] } = await pool.query(
      `SELECT COUNT(*) FROM orders o ${where}`, params
    );

    res.json({
      data: rows,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(count) },
    });
  } catch (err) { next(err); }
};

// ── GET /api/v1/orders/:id ────────────────────────────────────────────────────
exports.getOrder = async (req, res, next) => {
  try {
    const { rows: [order] } = await pool.query(
      `SELECT * FROM orders WHERE id = $1`, [req.params.id]
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const { rows: items } = await pool.query(`
      SELECT
        oi.id, oi.quantity, oi.price_at_purchase,
        p.name  AS product_name,  p.sku,
        ip.name AS package_name
      FROM order_items oi
      LEFT JOIN products p              ON p.id  = oi.product_id
      LEFT JOIN installation_packages ip ON ip.id = oi.package_id
      WHERE oi.order_id = $1
    `, [order.id]);

    res.json({ ...order, items });
  } catch (err) { next(err); }
};

// ── PATCH /api/v1/orders/:id/status ──────────────────────────────────────────
// Admin: advance order through the state machine
exports.updateStatus = async (req, res, next) => {
  const VALID_TRANSITIONS = {
    pending: ['paid', 'cancelled'],
    paid: ['processing', 'cancelled'],
    processing: ['dispatched'],
    dispatched: ['completed'],
    completed: [],
    cancelled: [],
  };

  try {
    const { status } = req.body;
    const { rows: [order] } = await pool.query(
      `SELECT * FROM orders WHERE id = $1`, [req.params.id]
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const allowed = VALID_TRANSITIONS[order.order_status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        error: `Cannot transition from '${order.order_status}' to '${status}'. Allowed: ${allowed.join(', ') || 'none'}`,
      });
    }

    await pool.query(
      `UPDATE orders SET order_status=$1, updated_at=NOW() WHERE id=$2`,
      [status, order.id]
    );

    // Send SMS on key transitions
    if (status === 'processing') {
      await queue.queueInstallationReminder({
        name: order.customer_name,
        phone: order.customer_phone,
        date: req.body.installDate || 'to be confirmed',
        time: req.body.installTime || '8:00 AM',
      });
    }

    res.json({ success: true, orderId: order.id, newStatus: status });
  } catch (err) { next(err); }
};

// ── POST /api/v1/orders/:id/sms ───────────────────────────────────────────────
// Admin: trigger a predefined SMS quick-action
exports.sendQuickSMS = async (req, res, next) => {
  try {
    const { type, date, time } = req.body;
    const { rows: [order] } = await pool.query(
      `SELECT * FROM orders WHERE id = $1`, [req.params.id]
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });

    switch (type) {
      case 'installation_reminder':
        await queue.queueInstallationReminder({
          name: order.customer_name, phone: order.customer_phone, date, time,
        });
        break;
      case 'site_visit_reminder':
        await queue.queueSiteVisitReminder({
          name: order.customer_name, phone: order.customer_phone, date,
        });
        break;
      case 'payment_link':
        await queue.queuePaymentLinkNotification({
          name: order.customer_name, phone: order.customer_phone,
          orderNumber: order.order_number, amount: order.total_amount,
          productName: 'Solar equipment',
        });
        break;
      default:
        return res.status(400).json({ error: `Unknown SMS type: ${type}` });
    }

    res.json({ success: true, message: `SMS '${type}' queued for ${order.customer_phone}` });
  } catch (err) { next(err); }
};
// ── DELETE /api/v1/orders/:id (admin) ─────────────────────────────────────────
exports.deleteOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rowCount } = await pool.query(
      `DELETE FROM orders WHERE id = $1`,
      [id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json({ success: true, deleted: id });
  } catch (err) {
    next(err);
  }
};