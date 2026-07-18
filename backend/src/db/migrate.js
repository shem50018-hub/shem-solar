// src/db/migrate.js
// Run with: node src/db/migrate.js
require('dotenv').config();
const pool = require('./pool');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄  Running migrations...');
    await client.query('BEGIN');

    // ── ENUMS ──────────────────────────────────────────────────────────────────
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE product_category AS ENUM (
          'panel', 'battery', 'inverter', 'charge_controller', 'accessory'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE customer_segment AS ENUM ('home', 'business', 'school', 'rural');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE order_status AS ENUM (
          'pending', 'paid', 'processing', 'dispatched', 'completed', 'cancelled'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE payment_status AS ENUM (
          'unpaid', 'processing', 'completed', 'failed'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE quote_status AS ENUM (
          'new', 'contacted', 'site_visit_scheduled', 'invoice_sent', 'closed_won', 'closed_lost'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // ── TABLE 1: products ──────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id               SERIAL PRIMARY KEY,
        sku              VARCHAR(50)  UNIQUE NOT NULL,
        name             VARCHAR(255) NOT NULL,
        slug             VARCHAR(255) UNIQUE NOT NULL,
        description      TEXT,
        category         product_category NOT NULL,
        price            DECIMAL(12, 2) NOT NULL,
        stock_quantity   INT NOT NULL DEFAULT 0,
        specifications   JSONB,
        is_active        BOOLEAN DEFAULT TRUE,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        updated_at       TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── ADD image_url TO products (if migrating existing table) ────────────────
    await client.query(`
  ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;
`);

    // ── TABLE 2: installation_packages ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS installation_packages (
        id                   SERIAL PRIMARY KEY,
        name                 VARCHAR(255) NOT NULL,
        slug                 VARCHAR(255) UNIQUE NOT NULL,
        description          TEXT,
        base_installation_fee DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        target_segment       customer_segment NOT NULL,
        is_active            BOOLEAN DEFAULT TRUE,
        created_at           TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── ADD image_url TO installation_packages ──────────────────────────────────
    await client.query(`
  ALTER TABLE installation_packages ADD COLUMN IF NOT EXISTS image_url TEXT;
`);

    // ── TABLE 3: package_items (junction) ─────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS package_items (
        package_id  INT REFERENCES installation_packages(id) ON DELETE CASCADE,
        product_id  INT REFERENCES products(id) ON DELETE RESTRICT,
        quantity    INT NOT NULL DEFAULT 1,
        PRIMARY KEY (package_id, product_id)
      );
    `);

    // ── TABLE 4: orders ───────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id                  SERIAL PRIMARY KEY,
        order_number        VARCHAR(100) UNIQUE NOT NULL,
        customer_name       VARCHAR(255) NOT NULL,
        customer_phone      VARCHAR(15)  NOT NULL,
        customer_email      VARCHAR(255),
        shipping_address    TEXT,
        total_amount        DECIMAL(12, 2) NOT NULL,
        order_status        order_status   DEFAULT 'pending',
        payment_status      payment_status DEFAULT 'unpaid',
        mpesa_checkout_id   VARCHAR(100) UNIQUE,
        mpesa_receipt_number VARCHAR(50),
        manual_payment_ref  VARCHAR(100),
        manual_payment_method VARCHAR(50),
        notes               TEXT,
        created_at          TIMESTAMPTZ DEFAULT NOW(),
        updated_at          TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Index for fast Daraja callback lookup
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_mpesa_checkout
      ON orders (mpesa_checkout_id)
      WHERE mpesa_checkout_id IS NOT NULL;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_phone
      ON orders (customer_phone);
    `);

    // ── TABLE 5: order_items ──────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id                  SERIAL PRIMARY KEY,
        order_id            INT REFERENCES orders(id) ON DELETE CASCADE,
        product_id          INT REFERENCES products(id),
        package_id          INT REFERENCES installation_packages(id),
        quantity            INT NOT NULL DEFAULT 1,
        price_at_purchase   DECIMAL(12, 2) NOT NULL,
        CONSTRAINT chk_item_type CHECK (
          (product_id IS NOT NULL AND package_id IS NULL) OR
          (product_id IS NULL    AND package_id IS NOT NULL)
        )
      );
    `);

    // ── TABLE 6: consultation_requests ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS consultation_requests (
        id                    SERIAL PRIMARY KEY,
        fullname              VARCHAR(255) NOT NULL,
        phone_number          VARCHAR(15)  NOT NULL,
        email                 VARCHAR(255),
        location              VARCHAR(255) NOT NULL,
        current_monthly_bill  DECIMAL(10, 2),
        property_type         customer_segment NOT NULL,
        additional_notes      TEXT,
        recommended_system    VARCHAR(255),
        estimated_value       DECIMAL(12, 2),
        status                quote_status DEFAULT 'new',
        assigned_to_staff_id  INT,
        call_log              TEXT,
        created_at            TIMESTAMPTZ DEFAULT NOW(),
        updated_at            TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── AUTO-UPDATE updated_at trigger ────────────────────────────────────────
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
      $$ LANGUAGE plpgsql;
    `);

    for (const tbl of ['products', 'orders', 'consultation_requests']) {
      await client.query(`
        DROP TRIGGER IF EXISTS trg_${tbl}_updated_at ON ${tbl};
        CREATE TRIGGER trg_${tbl}_updated_at
          BEFORE UPDATE ON ${tbl}
          FOR EACH ROW EXECUTE FUNCTION update_updated_at();
      `);
    }
    // ── TABLE 7: admin_users ──────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id            SERIAL PRIMARY KEY,
        username      VARCHAR(100) NOT NULL UNIQUE,
        email         VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        name          VARCHAR(255) NOT NULL,
        role          VARCHAR(50)  NOT NULL DEFAULT 'staff',
        is_active     BOOLEAN NOT NULL DEFAULT true,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query('COMMIT');
    console.log('✅  Migration complete — all tables created.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌  Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
