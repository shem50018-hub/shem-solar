// src/db/seed.js
require('dotenv').config();
const pool = require('./pool');

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🌱  Seeding database...');
    await client.query('BEGIN');

    // ── Products ──────────────────────────────────────────────────────────────
    const products = [
      {
        sku: 'SKU-PNL-400M',
        name: 'MonoPerc 400W Panel',
        slug: 'monoperc-400w-panel',
        description: 'High-efficiency monocrystalline PERC solar panel ideal for residential and commercial rooftops.',
        category: 'panel',
        price: 28000,
        stock_quantity: 45,
        specifications: {
          wattage: '400W', efficiency: '21.4%', cell_type: 'Monocrystalline PERC',
          dimensions: '1722×1134×35mm', weight_kg: 20.5,
          max_voltage: '49.6V', short_circuit_current: '10.8A',
          operating_temp: '-40°C to +85°C', warranty_years: 25
        }
      },
      {
        sku: 'SKU-BAT-LFP1',
        name: 'LiFePO4 100Ah Battery',
        slug: 'lifepo4-100ah-battery',
        description: 'Lithium Iron Phosphate battery — 4,000+ cycles, built-in BMS, maintenance-free.',
        category: 'battery',
        price: 55000,
        stock_quantity: 12,
        specifications: {
          capacity_ah: 100, voltage: '48V', chemistry: 'LiFePO4',
          cycle_life: 4000, depth_of_discharge_pct: 95,
          weight_kg: 28, bms: 'Built-in 100A continuous',
          operating_temp: '0°C to +55°C', warranty_years: 10
        }
      },
      {
        sku: 'SKU-INV-HYB5',
        name: 'Hybrid Inverter 5kW',
        slug: 'hybrid-inverter-5kw',
        description: 'Smart hybrid inverter with Wi-Fi monitoring and built-in MPPT charge controller.',
        category: 'inverter',
        price: 72000,
        stock_quantity: 18,
        specifications: {
          output_power: '5kW', type: 'Hybrid',
          mppt_voltage_range: '120–450V DC', battery_voltage: '48V',
          efficiency_pct: 97, grid_frequency: '50Hz',
          display: 'LCD + Wi-Fi app', warranty_years: 3
        }
      },
      {
        sku: 'SKU-BAT-GEL2',
        name: 'Gel Lead-Acid 200Ah',
        slug: 'gel-lead-acid-200ah',
        description: 'Reliable sealed gel VRLA battery — cost-effective for budget-conscious installations.',
        category: 'battery',
        price: 18500,
        stock_quantity: 8,
        specifications: {
          capacity_ah: 200, voltage: '12V', type: 'Sealed Gel VRLA',
          cycle_life: 600, depth_of_discharge_pct: 50,
          weight_kg: 56, self_discharge_pct_month: 3,
          operating_temp: '0°C to +40°C', warranty_years: 2
        }
      }
    ];

    for (const p of products) {
      await client.query(`
        INSERT INTO products (sku, name, slug, description, category, price, stock_quantity, specifications)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (sku) DO NOTHING
      `, [p.sku, p.name, p.slug, p.description, p.category, p.price, p.stock_quantity, JSON.stringify(p.specifications)]);
    }
    console.log(`  ✓ ${products.length} products seeded`);

    // ── Installation Packages ─────────────────────────────────────────────────
    const pkg1 = await client.query(`
      INSERT INTO installation_packages (name, slug, description, base_installation_fee, target_segment)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name
      RETURNING id
    `, [
      'Home Starter Kit 2kW',
      'home-starter-kit-2kw',
      'Complete 2kW home system: 5× 400W panels, 100Ah LiFePO4 battery, 2kW inverter + professional installation.',
      35000,
      'home'
    ]);

    const pkg2 = await client.query(`
      INSERT INTO installation_packages (name, slug, description, base_installation_fee, target_segment)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name
      RETURNING id
    `, [
      'Business Pro System 10kW',
      'business-pro-system-10kw',
      'Commercial-grade 10kW system: 25× panels, 4× batteries, 3-phase inverter, full EPRA-compliant installation.',
      120000,
      'business'
    ]);
    console.log('  ✓ 2 installation packages seeded');

    // Link package items
    const panelRow  = await client.query(`SELECT id FROM products WHERE sku='SKU-PNL-400M'`);
    const battRow   = await client.query(`SELECT id FROM products WHERE sku='SKU-BAT-LFP1'`);
    const invRow    = await client.query(`SELECT id FROM products WHERE sku='SKU-INV-HYB5'`);
    const panelId = panelRow.rows[0].id;
    const battId  = battRow.rows[0].id;
    const invId   = invRow.rows[0].id;
    const p1Id    = pkg1.rows[0].id;
    const p2Id    = pkg2.rows[0].id;

    const items = [
      [p1Id, panelId, 5],   // Starter: 5 panels
      [p1Id, battId,  1],   // Starter: 1 battery
      [p1Id, invId,   1],   // Starter: 1 inverter
      [p2Id, panelId, 25],  // Pro: 25 panels
      [p2Id, battId,  4],   // Pro: 4 batteries
      [p2Id, invId,   1],   // Pro: 1 inverter (10kW variant)
    ];
    for (const [pid, prid, qty] of items) {
      await client.query(`
        INSERT INTO package_items (package_id, product_id, quantity)
        VALUES ($1,$2,$3) ON CONFLICT DO NOTHING
      `, [pid, prid, qty]);
    }
    console.log('  ✓ Package items linked');

    await client.query('COMMIT');
    console.log('✅  Seed complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌  Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

seed();
