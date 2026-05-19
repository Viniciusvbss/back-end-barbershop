const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

let schemaReadyPromise = null;

const ensureBarberAuthColumns = async () => {
  if (schemaReadyPromise) return schemaReadyPromise;

  schemaReadyPromise = (async () => {
    const [emailRows] = await db.query('SHOW COLUMNS FROM barbers LIKE ?', ['email']);
    if (!emailRows.length) {
      await db.query('ALTER TABLE barbers ADD COLUMN email VARCHAR(255) NULL');
      await db.query('ALTER TABLE barbers ADD UNIQUE INDEX idx_barbers_email (email)');
    }
    const [passRows] = await db.query('SHOW COLUMNS FROM barbers LIKE ?', ['password']);
    if (!passRows.length) {
      await db.query('ALTER TABLE barbers ADD COLUMN password VARCHAR(255) NULL');
    }
  })().catch((error) => {
    schemaReadyPromise = null;
    throw error;
  });

  return schemaReadyPromise;
};

// POST /api/barber/auth/login
router.post('/login', async (req, res) => {
  try {
    await ensureBarberAuthColumns();

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'E-mail e senha sao obrigatorios' });
    }

    const [rows] = await db.query(
      'SELECT id, barbershop_id, name, password FROM barbers WHERE email = ?',
      [email.trim().toLowerCase()],
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'E-mail ou senha invalidos' });
    }

    const barber = rows[0];

    if (!barber.password) {
      return res.status(401).json({ error: 'Acesso ao dashboard nao configurado. Solicite ao administrador.' });
    }

    const valid = await bcrypt.compare(password, barber.password);
    if (!valid) {
      return res.status(401).json({ error: 'E-mail ou senha invalidos' });
    }

    const token = jwt.sign(
      { barber_id: barber.id, barbershop_id: barber.barbershop_id, name: barber.name },
      process.env.JWT_SECRET,
    );

    res.json({
      token,
      barber: { id: barber.id, name: barber.name, barbershop_id: barber.barbershop_id },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
