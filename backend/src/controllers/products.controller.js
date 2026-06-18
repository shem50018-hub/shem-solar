// src/controllers/products.controller.js
const pool = require('../db/pool');

// ── GET /api/v1/products ──────────────────────────────────────────────────────
// Public: active products, optional category filter
exports.listProducts = async (req, res, next) => {
  try {
    const { category } = req.query;
    const params = [];
    let where = 'WHERE p.is_active = true';
    if (category) {
      params.push(category);
      where += ` AND p.category = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT id, sku, name, slug, description, category,
              price, stock_quantity, specifications
       FROM products p ${where}
       ORDER BY category, name`,
      params
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
};

// ── GET /api/v1/products/:slug ────────────────────────────────────────────────
// Public: single product by slug
exports.getProduct = async (req, res, next) => {
  try {
    const { rows: [product] } = await pool.query(
      `SELECT id, sku, name, slug, description, category,
              price, stock_quantity, specifications
       FROM products WHERE slug = $1 AND is_active = true`,
      [req.params.slug]
    );
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) { next(err); }
};

// ── GET /api/v1/products/packages ────────────────────────────────────────────
// Public: installation packages with their component breakdown
exports.listPackages = async (req, res, next) => {
  try {
    const { rows: packages } = await pool.query(
      `SELECT id, name, slug, description, base_installation_fee, target_segment
       FROM installation_packages WHERE is_active = true ORDER BY base_installation_fee`
    );
    // Attach component products to each package
    for (const pkg of packages) {
      const { rows: items } = await pool.query(`
        SELECT p.id, p.name, p.sku, p.category, p.price, pi.quantity
        FROM package_items pi
        JOIN products p ON p.id = pi.product_id
        WHERE pi.package_id = $1
      `, [pkg.id]);
      pkg.components = items;
      // Compute total price: sum of (component price × qty) + installation fee
      pkg.total_price = items.reduce((sum, i) => sum + parseFloat(i.price) * i.quantity, 0)
                        + parseFloat(pkg.base_installation_fee);
    }
    res.json({ data: packages });
  } catch (err) { next(err); }
};

// ── POST /api/v1/products (admin) ─────────────────────────────────────────────
exports.createProduct = async (req, res, next) => {
  try {
    const { sku, name, slug, description, category, price, stock_quantity, specifications } = req.body;
    if (!sku || !name || !slug || !category || !price) {
      return res.status(400).json({ error: 'sku, name, slug, category and price are required' });
    }
    const { rows: [product] } = await pool.query(`
      INSERT INTO products (sku, name, slug, description, category, price, stock_quantity, specifications)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `, [sku, name, slug, description, category, price, stock_quantity || 0, JSON.stringify(specifications || {})]);
    res.status(201).json(product);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'SKU or slug already exists' });
    next(err);
  }
};

// ── PATCH /api/v1/products/:id (admin) ───────────────────────────────────────
exports.updateProduct = async (req, res, next) => {
  try {
    const fields  = ['name','slug','description','category','price','stock_quantity','specifications','is_active'];
    const updates = [];
    const params  = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        params.push(f === 'specifications' ? JSON.stringify(req.body[f]) : req.body[f]);
        updates.push(`${f} = $${params.length}`);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    const { rows: [product] } = await pool.query(
      `UPDATE products SET ${updates.join(', ')}, updated_at=NOW() WHERE id=$${params.length} RETURNING *`,
      params
    );
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) { next(err); }
};

// ── PATCH /api/v1/products/:id/stock (admin) ──────────────────────────────────
// Restock — add units to existing stock_quantity
exports.restockProduct = async (req, res, next) => {
  try {
    const { units } = req.body;
    if (!units || units < 1) return res.status(400).json({ error: 'units must be a positive integer' });
    const { rows: [product] } = await pool.query(
      `UPDATE products SET stock_quantity = stock_quantity + $1, updated_at=NOW()
       WHERE id=$2 RETURNING id, name, stock_quantity`,
      [parseInt(units), req.params.id]
    );
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json({ success: true, ...product });
  } catch (err) { next(err); }
};
