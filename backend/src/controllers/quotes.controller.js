// src/controllers/quotes.controller.js
const pool  = require('../db/pool');
const queue = require('../services/queue.service');
const mpesa = require('../services/mpesa.service');

// ── POST /api/v1/quotes ───────────────────────────────────────────────────────
// Public: customer submits a consultation request from the website
exports.createQuote = async (req, res, next) => {
  try {
    const {
      fullname, phone_number, email, location,
      current_monthly_bill, property_type,
      additional_notes, recommended_system, estimated_value,
    } = req.body;

    if (!fullname || !phone_number || !location || !property_type) {
      return res.status(400).json({
        error: 'fullname, phone_number, location and property_type are required',
      });
    }

    const { rows: [quote] } = await pool.query(`
      INSERT INTO consultation_requests
        (fullname, phone_number, email, location, current_monthly_bill,
         property_type, additional_notes, recommended_system, estimated_value)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id, fullname, phone_number, status, created_at
    `, [
      fullname, phone_number, email, location,
      current_monthly_bill || null, property_type,
      additional_notes, recommended_system, estimated_value || null,
    ]);

    // Notify admin via SMS that a new lead came in
    await queue.queueQuoteFollowUp({
      name:           fullname,
      phone:          phone_number,
      system:         recommended_system || 'solar system',
      estimatedValue: estimated_value   || 0,
    });

    res.status(201).json({
      success: true,
      quoteId: quote.id,
      message: 'Quote request received. Our team will contact you within 24 hours.',
    });
  } catch (err) { next(err); }
};

// ── GET /api/v1/quotes ────────────────────────────────────────────────────────
// Admin: list all quotes with optional stage filter
exports.listQuotes = async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 30 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    const conditions = [];

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(
        `(fullname ILIKE $${params.length} OR phone_number ILIKE $${params.length} OR location ILIKE $${params.length})`
      );
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT id, fullname, phone_number, email, location, property_type,
              recommended_system, estimated_value, status, created_at, updated_at
       FROM consultation_requests ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, parseInt(limit), offset]
    );
    const { rows: [{ count }] } = await pool.query(
      `SELECT COUNT(*) FROM consultation_requests ${where}`, params
    );
    res.json({
      data: rows,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(count) },
    });
  } catch (err) { next(err); }
};

// ── GET /api/v1/quotes/:id ────────────────────────────────────────────────────
exports.getQuote = async (req, res, next) => {
  try {
    const { rows: [quote] } = await pool.query(
      `SELECT * FROM consultation_requests WHERE id = $1`, [req.params.id]
    );
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json(quote);
  } catch (err) { next(err); }
};

// ── PATCH /api/v1/quotes/:id ──────────────────────────────────────────────────
// Admin: update stage, call notes, assigned staff, estimated value
exports.updateQuote = async (req, res, next) => {
  const VALID_STATUSES = ['new','contacted','site_visit_scheduled','invoice_sent','closed_won','closed_lost'];

  try {
    const { status, call_log, assigned_to_staff_id, estimated_value, recommended_system } = req.body;

    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const fields  = { status, call_log, assigned_to_staff_id, estimated_value, recommended_system };
    const updates = [];
    const params  = [];
    for (const [key, val] of Object.entries(fields)) {
      if (val !== undefined) {
        params.push(val);
        updates.push(`${key} = $${params.length}`);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

    params.push(req.params.id);
    const { rows: [quote] } = await pool.query(
      `UPDATE consultation_requests SET ${updates.join(', ')}, updated_at=NOW()
       WHERE id=$${params.length} RETURNING *`,
      params
    );
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json(quote);
  } catch (err) { next(err); }
};

// ── POST /api/v1/quotes/:id/send-payment-link ─────────────────────────────────
// Admin: convert a priced quote into a real M-Pesa STK push sent to the customer
// This is the "Quote → Order" pipeline conversion
exports.sendPaymentLink = async (req, res, next) => {
  try {
    const { rows: [quote] } = await pool.query(
      `SELECT * FROM consultation_requests WHERE id = $1`, [req.params.id]
    );
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    if (!quote.estimated_value) {
      return res.status(400).json({ error: 'Set an estimated_value on this quote before sending a payment link' });
    }

    // 1. Create an order from the quote
    const orderNumber = `SOLAR-${new Date().getFullYear()}-${Math.random().toString(36).substr(2,4).toUpperCase()}`;

    const { rows: [order] } = await pool.query(`
      INSERT INTO orders
        (order_number, customer_name, customer_phone, customer_email,
         shipping_address, total_amount)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id, order_number, total_amount
    `, [
      orderNumber, quote.fullname, quote.phone_number,
      quote.email, quote.location, quote.estimated_value,
    ]);

    // 2. Initiate STK push directly to customer's phone
    const { checkoutRequestId } = await mpesa.initiateSTKPush({
      phone:       quote.phone_number,
      amount:      quote.estimated_value,
      orderNumber: order.order_number,
      description: quote.recommended_system || `Shem Solar – ${order.order_number}`,
    });

    // 3. Store the CheckoutRequestID
    await pool.query(
      `UPDATE orders SET mpesa_checkout_id=$1, payment_status='processing' WHERE id=$2`,
      [checkoutRequestId, order.id]
    );

    // 4. Advance the quote stage to invoice_sent
    await pool.query(
      `UPDATE consultation_requests SET status='invoice_sent', updated_at=NOW() WHERE id=$1`,
      [quote.id]
    );

    // 5. Notify customer via SMS as well
    await queue.queuePaymentLinkNotification({
      name:        quote.fullname,
      phone:       quote.phone_number,
      orderNumber: order.order_number,
      amount:      quote.estimated_value,
      productName: quote.recommended_system || 'Solar system',
    });

    res.json({
      success:     true,
      orderId:     order.id,
      orderNumber: order.order_number,
      message:     `STK Push sent to ${quote.phone_number}. SMS confirmation also queued.`,
    });
  } catch (err) { next(err); }
};

// ── GET /api/v1/quotes/pipeline ───────────────────────────────────────────────
// Admin: counts per stage — used by the dashboard kanban
exports.pipeline = async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT status, COUNT(*) AS count, COALESCE(SUM(estimated_value),0) AS pipeline_value
      FROM consultation_requests
      GROUP BY status
      ORDER BY status
    `);
    res.json({ data: rows });
  } catch (err) { next(err); }
};
