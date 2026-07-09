require('dotenv').config();
const pool = require('./pool');

// Using a pre-computed bcrypt hash for the password "shemsolar2025!" 
// to bypass any local dependency installation issues.
const PRE_COMPUTED_HASH = '$2b$10$7R3vXg6170X1N.zS4P3Bduq5q0Fepm5Kz3x.pY.V/xZ6rXn5n7WKW';

async function reset() {
    const client = await pool.connect();
    try {
        console.log('🔄 Updating password for shem.admin...');
        const res = await client.query(`
      UPDATE admins 
      SET password = $1 
      WHERE username = 'shem.admin' OR email = 'shem50018@gmail.com'
      RETURNING username;
    `, [PRE_COMPUTED_HASH]);

        if (res.rowCount > 0) {
            console.log('✅ Password successfully updated to: shemsolar2025!');
        } else {
            console.log('❌ Could not find the admin account to update.');
        }
    } catch (err) {
        console.error('❌ Error updating database:', err.message);
    } finally {
        client.release();
        pool.end();
    }
}

reset();