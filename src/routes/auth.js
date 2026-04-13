const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const {
  ensureBarbershopSettingsColumns,
  getBarbershopSelectFields,
  normalizeBarbershopRow,
} = require('../utils/barbershopSettings');

const isBcryptHash = (value) => typeof value === 'string' && (value.startsWith('$2a$') || value.startsWith('$2b$'));

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Campos obrigatorios: email, password' });
  }

  try {
    await ensureBarbershopSettingsColumns(db);

    const [rows] = await db.query(
      `SELECT ${getBarbershopSelectFields()}, password FROM barbershops WHERE email = ?`,
      [String(email).trim().toLowerCase()],
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'Email ou senha invalidos' });
    }

    const barbershop = rows[0];
    const storedPassword = barbershop.password;
    let passwordValid = false;

    if (isBcryptHash(storedPassword)) {
      passwordValid = await bcrypt.compare(password, storedPassword);
    } else {
      // Registros legados continuam funcionando e sao migrados para hash no primeiro login valido.
      passwordValid = password === storedPassword;

      if (passwordValid) {
        const hashed = await bcrypt.hash(password, 12);
        await db.query(
          'UPDATE barbershops SET password = ?, password_updated_at = NOW() WHERE id = ?',
          [hashed, barbershop.id],
        );
      }
    }

    if (!passwordValid) {
      return res.status(401).json({ error: 'Email ou senha invalidos' });
    }

    const token = jwt.sign(
      { id: barbershop.id, email: barbershop.email, name: barbershop.name },
      process.env.JWT_SECRET,
      { expiresIn: '7d' },
    );

    res.json({
      token,
      barbershop: normalizeBarbershopRow(barbershop),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
