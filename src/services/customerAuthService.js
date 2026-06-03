// @ts-check
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const customerRepo = require('../repositories/customerRepository');
const { ValidationError, UnauthorizedError, ConflictError } = require('../errors/AppError');

const register = async (db, { name, email, password, phone }) => {
  if (!name || !email || !password) {
    throw new ValidationError('Campos obrigatorios: name, email, password');
  }
  if (password.length < 6) {
    throw new ValidationError('A senha deve ter pelo menos 6 caracteres.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
    throw new ValidationError('Informe um e-mail valido.');
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedName = String(name).trim();
  const normalizedPhone = phone ? String(phone).replace(/\D/g, '') : null;

  const existing = await customerRepo.findByEmail(db, normalizedEmail);
  if (existing) throw new ConflictError('E-mail ja cadastrado.');

  const passwordHash = await bcrypt.hash(password, 12);

  let customerId;
  try {
    const [result] = await db.query(
      'INSERT INTO customers (name, phone, email, password_hash) VALUES (?, ?, ?, ?)',
      [normalizedName, normalizedPhone || null, normalizedEmail, passwordHash],
    );
    customerId = result.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new ConflictError('E-mail ou telefone ja cadastrado.');
    throw err;
  }

  const token = jwt.sign(
    { id: customerId, email: normalizedEmail, name: normalizedName, type: 'customer' },
    process.env.JWT_SECRET,
    { expiresIn: '30d' },
  );

  return {
    token,
    customer: { id: customerId, name: normalizedName, email: normalizedEmail, phone: normalizedPhone },
  };
};

const login = async (db, { email, password, rememberMe }) => {
  if (!email || !password) throw new ValidationError('Campos obrigatorios: email, password');

  const customer = await customerRepo.findByEmail(db, String(email).trim().toLowerCase());
  if (!customer || !customer.password_hash) throw new UnauthorizedError('E-mail ou senha invalidos');

  const valid = await bcrypt.compare(password, customer.password_hash);
  if (!valid) throw new UnauthorizedError('E-mail ou senha invalidos');

  const token = jwt.sign(
    { id: customer.id, email: customer.email, name: customer.name, type: 'customer' },
    process.env.JWT_SECRET,
    { expiresIn: rememberMe ? '30d' : '1d' },
  );

  return {
    token,
    customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone },
  };
};

module.exports = { register, login };
