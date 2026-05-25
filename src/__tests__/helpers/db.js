// Conexão com o banco de testes. O banco deve existir e ter o schema aplicado.
// Use DB_NAME=barbershop_saas_test em .env.test para isolar dos dados reais.
const mysql = require('mysql2/promise');

let pool;

const getPool = () => {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 5,
      timezone: '+00:00',
    });
  }
  return pool;
};

const cleanup = async (db, barbershopId) => {
  await db.query('DELETE FROM appointments WHERE barbershop_id = ?', [barbershopId]);
  await db.query('DELETE FROM business_hours WHERE barbershop_id = ?', [barbershopId]);
  await db.query('DELETE FROM services WHERE barbershop_id = ?', [barbershopId]);
  await db.query('DELETE FROM barbers WHERE barbershop_id = ?', [barbershopId]);
  await db.query('DELETE FROM customers WHERE barbershop_id = ?', [barbershopId]);
  await db.query('DELETE FROM barbershops WHERE id = ?', [barbershopId]);
};

module.exports = { getPool, cleanup };
