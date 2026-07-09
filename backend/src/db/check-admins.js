require('dotenv').config();
const pool = require('./pool');

async function checkAdmins() {
    try {
        const { rows } = await pool.query(
            `SELECT id, username, email, name, role, is_active, created_at
       FROM admin_users
       ORDER BY id`
        );
        console.log(`\n📋 Found ${rows.length} admin account(s):\n`);
        rows.forEach(u => {
            console.log(`  [${u.id}] ${u.username} (${u.name}) — role: ${u.role} — active: ${u.is_active} — email: ${u.email}`);
        });
        console.log('');
    } catch (err) {
        console.error('❌ Query failed:', err.message);
    } finally {
        pool.end();
    }
}

checkAdmins();