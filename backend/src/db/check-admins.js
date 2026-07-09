require('dotenv').config();
const pool = require('./pool');

async function checkTables() {
    try {
        const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public';
    `);
        console.log("📊 Real Live Tables:", res.rows.map(r => r.table_name));
    } catch (err) {
        console.error("❌ Error reading tables:", err.message);
    } finally {
        pool.end();
    }
}
checkTables();