const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const barberRepo = require('../repositories/barberRepository');
const { ValidationError, UnauthorizedError } = require('../errors/AppError');

router.post('/login', async (req, res, next) => {
  try {
    await barberRepo.ensureSchema(db);

    const { email, password } = req.body;
    if (!email || !password) throw new ValidationError('E-mail e senha sao obrigatorios');

    const [rows] = await db.query(
      'SELECT id, barbershop_id, name, password FROM barbers WHERE email = ?',
      [String(email).trim().toLowerCase()],
    );

    if (!rows.length) throw new UnauthorizedError('E-mail ou senha invalidos');

    const barber = rows[0];
    if (!barber.password) throw new UnauthorizedError('Acesso ao dashboard nao configurado. Solicite ao administrador.');

    const valid = await bcrypt.compare(password, barber.password);
    if (!valid) throw new UnauthorizedError('E-mail ou senha invalidos');

    const token = jwt.sign(
      { barber_id: barber.id, barbershop_id: barber.barbershop_id, name: barber.name },
      process.env.JWT_SECRET,
    );

    res.json({ token, barber: { id: barber.id, name: barber.name, barbershop_id: barber.barbershop_id } });
  } catch (err) { next(err); }
});

module.exports = router;
