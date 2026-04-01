const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Campos obrigatórios: email, password' });
  }

  try {
    const [rows] = await db.query(
      'SELECT id, name, email, password FROM barbershops WHERE email = ?',
      [email]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'Email ou senha inválidos' });
    }

    const barbershop = rows[0];
    const storedPassword = barbershop.password;
    let passwordValid = false;

    const isBcryptHash = storedPassword.startsWith('$2b$') || storedPassword.startsWith('$2a$');

    if (isBcryptHash) {
      passwordValid = await bcrypt.compare(password, storedPassword);
    } else {
      // Senha ainda em plain text — comparação direta
      passwordValid = password === storedPassword;

      if (passwordValid) {
        // Lazy migration: hashear e salvar
        const hashed = await bcrypt.hash(password, 12);
        await db.query('UPDATE barbershops SET password = ? WHERE id = ?', [hashed, barbershop.id]);
      }
    }

    if (!passwordValid) {
      return res.status(401).json({ error: 'Email ou senha inválidos' });
    }

    const token = jwt.sign(
      { id: barbershop.id, email: barbershop.email, name: barbershop.name },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      barbershop: {
        id: barbershop.id,
        name: barbershop.name,
        email: barbershop.email,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
