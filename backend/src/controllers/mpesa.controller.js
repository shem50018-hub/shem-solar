// src/controllers/mpesa.controller.js
const pool          = require('../db/pool');
const mpesaService  = require('../services/mpesa.service');
const stockService  = require('../services/stock.service');
const queue         = require('../services/queue.service');

// ── GET /api/v1/mpesa/status/:checkoutRequestId ───────────────────────────────
// Lightweight public poll — returns just enough for the frontend to know outcome
exports.checkStatus = async (req, res) => {
  try {
    const { rows: [order] } = await pool.query(
      `SELECT payment_status, order_status, mpesa_receipt_number
       FROM orders WHERE mpesa_checkout_id = $1`,
      [req.params.checkoutRequestId]
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({
      payment_status:       order.payment_status,
      order_status:         order.order_status,
      mpesa_receipt_number: order.mpesa_receipt_number,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/v1/mpesa/stk-push ───────────────────────────────────────────────
// 1. Create an order record with status pending/unpaid
// 2. Initiate the Daraja STK push
// 3. Store the CheckoutRequestID for callback matching
// 4. Return immediately — payment confirmation comes via /callback
exports.initiateSTKPush = async (req, res) => {
  const { phone, items, customerName, customerEmail, shippingAddress } = req.body;

  if (!phone || !items?.length || !customerName) {
    return res.status(400).json({ error: 'phone, items, and customerName are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Build order number e.g. SOLAR-2026-A3F7
    const orderNumber = `SOLAR-${new Date().getFullYear()}-${Math.random().toString(36).substr(2,4).toUpperCase()}`;

    // Calculate total
    let total = 0;
    for (const item of items) {
      // Fetch current price from DB (never trust client-side price)
      if (item.productId) {
        const { rows } = await client.query(
          `SELECT price FROM products WHERE id=$1 AND is_active=true`, [item.productId]
        );
        if (!rows.length) throw new Error(`Product ${item.productId} not found`);
        total += rows[0].price * item.quantity;
        item.price = rows[0].price;
      } else if (item.packageId) {
        // Package price = sum of component prices + installation fee
        const { rows } = await client.query(`
          SELECT COALESCE(SUM(p.price * pi.quantity), 0) + ip.base_installation_fee AS pkg_price
          FROM package_items pi
          JOIN products p ON p.id = pi.product_id
          JOIN installation_packages ip ON ip.id = pi.package_id
          WHERE pi.package_id = $1
          GROUP BY ip.base_installation_fee
        `, [item.packageId]);
        if (!rows.length) throw new Error(`Package ${item.packageId} not found`);
        total += rows[0].pkg_price * item.quantity;
        item.price = rows[0].pkg_price;
      }
    }

    // Insert order
    const { rows: [order] } = await client.query(`
      INSERT INTO orders
        (order_number, customer_name, customer_phone, customer_email, shipping_address, total_amount)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id, order_number, total_amount
    `, [orderNumber, customerName, phone, customerEmail, shippingAddress, total]);

    // Insert order items
    for (const item of items) {
      await client.query(`
        INSERT INTO order_items (order_id, product_id, package_id, quantity, price_at_purchase)
        VALUES ($1, $2, $3, $4, $5)
      `, [order.id, item.productId || null, item.packageId || null, item.quantity, item.price]);
    }

    // Initiate STK push
    const { checkoutRequestId } = await mpesaService.initiateSTKPush({
      phone,
      amount:      total,
      orderNumber: order.order_number,
      description: `Shem Solar – ${order.order_number}`,
    });

    // Store CheckoutRequestID — this is the key for callback matching
    await client.query(
      `UPDATE orders SET mpesa_checkout_id=$1, payment_status='processing' WHERE id=$2`,
      [checkoutRequestId, order.id]
    );

    await client.query('COMMIT');

    res.json({
      success:          true,
      orderId:          order.id,
      orderNumber:      order.order_number,
      totalAmount:      order.total_amount,
      checkoutRequestId,
      message:          'STK Push sent. Please check your phone and enter your M-Pesa PIN.',
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('STK Push error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// ── POST /api/v1/mpesa/callback ───────────────────────────────────────────────
// Safaricom calls this after the customer enters their PIN (or cancels).
// ⚠️ Always respond HTTP 200 immediately — Safaricom will retry on any other code.
// All heavy work (stock deduction, SMS) happens in the background.
exports.handleCallback = async (req, res) => {
  // Respond to Safaricom immediately
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });

  // Process in background — do not await
  processPaymentCallback(req.body).catch(err =>
    console.error('Callback processing error:', err.message)
  );
};

async function processPaymentCallback(body) {
  const parsed = mpesaService.parseCallback(body);
  const { checkoutRequestId } = parsed;

  const client = await pool.connect();
  try {
    // Look up the order by CheckoutRequestID
    const { rows } = await client.query(
      `SELECT id, order_number, customer_name, customer_phone, total_amount
       FROM orders WHERE mpesa_checkout_id = $1`,
      [checkoutRequestId]
    );

    if (!rows.length) {
      console.error(`Callback: no order found for CheckoutRequestID ${checkoutRequestId}`);
      return;
    }

    const order = rows[0];

    if (!parsed.success) {
      // Payment failed or was cancelled
      await pool.query(
        `UPDATE orders SET payment_status='failed', order_status='cancelled', updated_at=NOW()
         WHERE id=$1`,
        [order.id]
      );
      await queue.queuePaymentFailed({
        name:        order.customer_name,
        phone:       order.customer_phone,
        orderNumber: order.order_number,
      });
      console.log(`Payment failed for order ${order.order_number}: ${parsed.reason}`);
      return;
    }

    // ── Payment successful — run everything in one transaction ────────────────
    await client.query('BEGIN');

    // 1. Mark order as paid
    await client.query(`
      UPDATE orders
      SET payment_status        = 'completed',
          order_status          = 'paid',
          mpesa_receipt_number  = $1,
          updated_at            = NOW()
      WHERE id = $2
    `, [parsed.receiptNumber, order.id]);

    // 2. Deduct stock (inside same transaction — rolls back on failure)
    await stockService.deductStockForOrder(order.id, client);

    await client.query('COMMIT');

    // 3. Queue SMS confirmation (outside transaction — non-critical)
    const { rows: itemRows } = await pool.query(`
      SELECT
        COALESCE(p.name, ip.name) AS product_name
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN installation_packages ip ON ip.id = oi.package_id
      WHERE oi.order_id = $1
      LIMIT 1
    `, [order.id]);

    await queue.queueOrderConfirmation({
      name:        order.customer_name,
      phone:       order.customer_phone,
      orderNumber: order.order_number,
      product:     itemRows[0]?.product_name || 'Solar equipment',
      amount:      parsed.amount,
    });

    console.log(`✅ Payment confirmed for order ${order.order_number} — receipt: ${parsed.receiptNumber}`);

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`Failed to process callback for ${checkoutRequestId}:`, err.message);
    // TODO: alert admin via SMS/email if this fails repeatedly
  } finally {
    client.release();
  }
}

// ── POST /api/v1/mpesa/manual-payment (admin) ─────────────────────────────────
// For bank transfers, cheques, RTGS — triggers same downstream logic as Daraja callback
exports.manualPayment = async (req, res) => {
  const { orderId, paymentMethod, paymentRef } = req.body;
  if (!orderId || !paymentMethod || !paymentRef) {
    return res.status(400).json({ error: 'orderId, paymentMethod, and paymentRef are required' });
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, order_number, customer_name, customer_phone, total_amount, payment_status
       FROM orders WHERE id=$1`, [orderId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Order not found' });
    const order = rows[0];
    if (order.payment_status === 'completed') {
      return res.status(409).json({ error: 'Order already marked as paid' });
    }

    await client.query('BEGIN');

    await client.query(`
      UPDATE orders
      SET payment_status       = 'completed',
          order_status         = 'paid',
          manual_payment_ref   = $1,
          manual_payment_method= $2,
          updated_at           = NOW()
      WHERE id = $3
    `, [paymentRef, paymentMethod, order.id]);

    await stockService.deductStockForOrder(order.id, client);

    await client.query('COMMIT');

    // SMS notification
    await queue.queueOrderConfirmation({
      name:        order.customer_name,
      phone:       order.customer_phone,
      orderNumber: order.order_number,
      product:     `${paymentMethod} payment`,
      amount:      order.total_amount,
    });

    res.json({ success: true, message: `Order ${order.order_number} marked as paid via ${paymentMethod}` });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Manual payment error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};
