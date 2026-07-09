require('dotenv').config();
const pool = require('./pool');
const bcrypt = require('bcrypt'); // or whatever hashing library your auth controller uses

async function seedAdmin() {
    const client = await pool.connect();
    try {
        console.log('🌱 Seeding Admin User...');

        // Hash your password (assuming your backend uses bcrypt with 10 salt rounds)
        const plainPassword = 'YOUR_SECURE_PASSWORD'; // 👈 Put the password you want here
        const hashedPassword = await bcrypt.hash(plainPassword, 10);

        await client.query(`
      INSERT INTO admins (name, username, email, password, role, is_active)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (email) DO NOTHING
    `, [
            'Shem Kyalo',
            'shem.admin',
            'shem50018@gmail.com',
            hashedPassword,
            'super_admin',
            true
        ]);

        console.log('✅ Admin user seeded successfully.');
    } catch (err) {
        console.error('❌ Admin seed failed:', err.message);
    } finally {
        client.release();
        pool.end();
    }
}

seedAdmin();