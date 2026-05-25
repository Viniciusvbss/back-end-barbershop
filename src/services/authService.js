const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const barbershopRepo = require('../repositories/barbershopRepository');
const authRepo = require('../repositories/authRepository');
const { sendPasswordResetEmail } = require('../utils/mailer');
const { normalizeBarbershopRow } = require('../utils/barbershopSettings');
const { ValidationError, UnauthorizedError } = require('../errors/AppError');

const RESET_TOKEN_MINUTES = 30;

const isBcryptHash = (v) => typeof v === 'string' && (v.startsWith('$2a$') || v.startsWith('$2b$'));

const getRequestIp = (req) => (
  req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
  req.socket?.remoteAddress ||
  null
);

const login = async (db, { email, password, rememberMe }) => {
  if (!email || !password) throw new ValidationError('Campos obrigatorios: email, password');

  const barbershop = await barbershopRepo.findByEmail(db, String(email).trim().toLowerCase());
  if (!barbershop) throw new UnauthorizedError('Email ou senha invalidos');

  const stored = barbershop.password;
  let valid = false;

  if (isBcryptHash(stored)) {
    valid = await bcrypt.compare(password, stored);
  } else {
    valid = password === stored;
    if (valid) await barbershopRepo.updatePassword(db, barbershop.id, await bcrypt.hash(password, 12));
  }

  if (!valid) throw new UnauthorizedError('Email ou senha invalidos');

  const token = jwt.sign(
    { id: barbershop.id, email: barbershop.email, name: barbershop.name },
    process.env.JWT_SECRET,
    { expiresIn: rememberMe ? '30d' : '1d' },
  );

  return { token, barbershop: normalizeBarbershopRow(barbershop) };
};

const forgotPassword = async (db, req, email) => {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) throw new ValidationError('Informe o email cadastrado.');

  await authRepo.ensureTables(db);

  const [rows] = await db.query('SELECT id, email FROM barbershops WHERE email = ? LIMIT 1', [normalized]);
  const barbershop = rows[0];

  if (!barbershop) {
    await authRepo.logRecoveryAttempt(db, {
      email: normalized, barbershopId: null, success: false,
      ipAddress: getRequestIp(req), userAgent: req.headers['user-agent'] || null,
    });
    return { sent: false };
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  await authRepo.invalidatePreviousResets(db, barbershop.id);
  await authRepo.createReset(db, barbershop.id, rawToken, RESET_TOKEN_MINUTES);

  await authRepo.logRecoveryAttempt(db, {
    email: normalized, barbershopId: barbershop.id, success: true,
    ipAddress: getRequestIp(req), userAgent: req.headers['user-agent'] || null,
  });

  const frontendUrl = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:5173';
  const resetLink = `${frontendUrl.replace(/\/$/, '')}/reset-password?token=${rawToken}`;
  const emailResult = await sendPasswordResetEmail({ to: barbershop.email, resetLink });

  return { sent: emailResult.sent, preview: emailResult.preview, resetLink: !emailResult.sent ? emailResult.preview : undefined };
};

const resetPassword = async (db, { token, password, confirmPassword }) => {
  if (!token) throw new ValidationError('Token de recuperacao ausente.');
  if (!password || password.length < 6) throw new ValidationError('A nova senha deve ter pelo menos 6 caracteres.');
  if (password !== confirmPassword) throw new ValidationError('A confirmacao da senha nao confere.');

  await authRepo.ensureTables(db);

  const reset = await authRepo.findValidReset(db, token);
  if (!reset) throw new ValidationError('Link invalido ou expirado.');

  const hashed = await bcrypt.hash(password, 12);
  await barbershopRepo.updatePassword(db, reset.barbershop_id, hashed);
  await authRepo.markResetUsed(db, reset.id);
};

module.exports = { login, forgotPassword, resetPassword };
