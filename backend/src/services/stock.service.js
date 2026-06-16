// src/services/stock.service.js
// All deductions run inside a single BEGIN/COMMIT transaction.
// If any product is out of stock the entire transaction rolls back —
// preventing partial deductions and double-sells.

const pool = require('../db/pool');

/**
 * Deduct stock for all items in an order.
 * Called only after payment_status transitions to 'completed'.
 *
 * @param {number} orderId
 * @param {Object} client - existing pg client (to stay in same transaction)
 */
async function deductStockForOrder(orderId, client) {
  // Fetch all line items for this order
  const { rows: items } = await client.query(
    `SELECT oi.product_id, oi.package_id, oi.quantity
     FROM order_items oi WHERE oi.order_id = $1`,
    [orderId]
  );

  for (const item of items) {
    if (item.product_id) {
      // ── Standalone product ──────────────────────────────────────────────────
      await deductProduct(client, item.product_id, item.quantity);

    } else if (item.package_id) {
      // ── Package: fetch all sub-components and deduct each ──────────────────
      const { rows: components } = await client.query(
        `SELECT product_id, quantity FROM package_items WHERE package_id = $1`,
        [item.package_id]
      );
      for (const comp of components) {
        await deductProduct(client, comp.product_id, comp.quantity * item.quantity);
      }
    }
  }
}

/**
 * Deduct qty from a single product's stock.
 * Raises an error if stock would go negative — pg will roll back the transaction.
 */
async function deductProduct(client, productId, qty) {
  const result = await client.query(
    `UPDATE products
     SET stock_quantity = stock_quantity - $1,
         updated_at     = NOW()
     WHERE id = $2 AND stock_quantity >= $1
     RETURNING id, name, stock_quantity`,
    [qty, productId]
  );

  if (result.rowCount === 0) {
    // Either product not found or insufficient stock
    const { rows } = await client.query(
      `SELECT name, stock_quantity FROM products WHERE id = $1`,
      [productId]
    );
    const p = rows[0];
    throw new Error(
      p
        ? `Insufficient stock for "${p.name}": need ${qty}, have ${p.stock_quantity}`
        : `Product id ${productId} not found`
    );
  }

  const { name, stock_quantity } = result.rows[0];
  console.log(`  📦 Stock deducted: "${name}" → ${stock_quantity} remaining`);

  // Warn if stock is low (< 3 units) — could trigger a reorder notification
  if (stock_quantity < 3) {
    console.warn(`  ⚠️  LOW STOCK: "${name}" has only ${stock_quantity} unit(s) left`);
  }
}

module.exports = { deductStockForOrder };
