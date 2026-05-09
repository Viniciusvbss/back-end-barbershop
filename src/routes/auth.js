const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { sendPasswordResetEmail } = require('../utils/mailer');
const {
  ensureBarbershopSettingsColumns,
  getBarbershopSelectFields,
  normalizeBarbershopRow,
} = require('../utils/barbershopSettings');

const RESET_TOKEN_MINUTES = 30;

const getProtectedBarbershop = (barbershop) => {
  const normalized = normalizeBarbershopRow(barbershop);
  return {
    ...normalized,
    logo_url: normalized.logo_url ? `/api/barbershops/${normalized.id}/logo` : null,
  };
};

const isBcryptHash = (value) => (
  typeof value === 'string' && (value.startsWith('$2a$') || value.startsWith('$2b$'))
);

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const getRequestIp = (req) => (
  req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
  req.socket?.remoteAddress ||
  null
);

const ensurePasswordResetTables = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      barbershop_id INT NOT NULL,
      token_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_password_resets_token_hash (token_hash),
      INDEX idx_password_resets_barbershop_id (barbershop_id),
      CONSTRAINT fk_password_resets_barbershop
        FOREIGN KEY (barbershop_id) REFERENCES barbershops(id)
        ON DELETE CASCADE
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS password_recovery_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      barbershop_id INT NULL,
      success TINYINT(1) NOT NULL DEFAULT 0,
      ip_address VARCHAR(45) NULL,
      user_agent TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_password_recovery_logs_email (email),
      INDEX idx_password_recovery_logs_created_at (created_at)
    )
  `);
};

const registerRecoveryLog = async (req, { email, barbershopId, success }) => {
  await db.query(
    `INSERT INTO password_recovery_logs
     (email, barbershop_id, success, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
    [
      email,
      barbershopId || null,
      success ? 1 : 0,
      getRequestIp(req),
      req.headers['user-agent'] || null,
    ],
  );
};

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password, rememberMe } = req.body;

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
      { expiresIn: rememberMe ? '30d' : '1d' },
    );

    res.json({
      token,
      barbershop: getProtectedBarbershop(barbershop),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/forgot-password', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const genericMessage = 'Se esse email estiver cadastrado, enviaremos um link de recuperacao.';

  if (!email) {
    return res.status(400).json({ error: 'Informe o email cadastrado.' });
  }

  try {
    await ensurePasswordResetTables();

    const [rows] = await db.query(
      'SELECT id, email FROM barbershops WHERE email = ? LIMIT 1',
      [email],
    );

    const barbershop = rows[0];

    if (!barbershop) {
      await registerRecoveryLog(req, { email, success: false });
      return res.json({ message: genericMessage });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);

    await db.query(
      'UPDATE password_resets SET used_at = NOW() WHERE barbershop_id = ? AND used_at IS NULL',
      [barbershop.id],
    );

    await db.query(
      `INSERT INTO password_resets (barbershop_id, token_hash, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
      [barbershop.id, tokenHash, RESET_TOKEN_MINUTES],
    );

    await registerRecoveryLog(req, { email, barbershopId: barbershop.id, success: true });

    const frontendUrl = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:5173';
    const resetLink = `${frontendUrl.replace(/\/$/, '')}/reset-password?token=${rawToken}`;
    const emailResult = await sendPasswordResetEmail({ to: barbershop.email, resetLink });

    res.json({
      message: genericMessage,
      resetLink: emailResult.sent ? undefined : emailResult.preview,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/reset-password', async (req, res) => {
  const token = String(req.body.token || '').trim();
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirmPassword || '');

  if (!token) {
    return res.status(400).json({ error: 'Token de recuperacao ausente.' });
  }

  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'A confirmacao da senha nao confere.' });
  }

  try {
    await ensurePasswordResetTables();

    const [rows] = await db.query(
      `SELECT id, barbershop_id
       FROM password_resets
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
       LIMIT 1`,
      [hashToken(token)],
    );

    const reset = rows[0];

    if (!reset) {
      return res.status(400).json({ error: 'Link invalido ou expirado.' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await db.query(
      'UPDATE barbershops SET password = ?, password_updated_at = NOW() WHERE id = ?',
      [hashedPassword, reset.barbershop_id],
    );

    await db.query(
      'UPDATE password_resets SET used_at = NOW() WHERE id = ?',
      [reset.id],
    );

    res.json({ message: 'Senha redefinida com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
