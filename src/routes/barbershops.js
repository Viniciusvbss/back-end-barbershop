const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');
const {
  DEFAULT_BRAND_PRIMARY_COLOR,
  DEFAULT_BRAND_SECONDARY_COLOR,
  DEFAULT_DAILY_SUMMARY_TIME,
  DEFAULT_REMINDER_HOURS,
  ensureBarbershopSettingsColumns,
  getBarbershopSelectFields,
  getPublicBarbershopSelectFields,
  normalizeBarbershopRow,
} = require('../utils/barbershopSettings');

const getErrorMessage = (error) => error?.message || 'Erro interno do servidor';

const parseBoolean = (value, fieldName) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  throw new Error(`Campo invalido: ${fieldName}`);
};

const normalizeHexColor = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toUpperCase();
  return /^#([0-9A-F]{3}|[0-9A-F]{6})$/.test(normalized) ? normalized : null;
};

const normalizeTime = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(normalized) ? normalized : null;
};

const normalizeSlug = (value) => {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
};

const normalizeLogoValue = (value) => {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new Error('Campo invalido: logo_url');
  }

  const trimmed = value.trim();
  const logoPattern = /^data:image\/(png|jpg|jpeg|svg\+xml);base64,[a-z0-9+/=\s]+$/i;

  if (!logoPattern.test(trimmed)) {
    throw new Error('Logo invalida. Envie PNG, JPG, JPEG ou SVG em base64.');
  }

  if (trimmed.length > 4 * 1024 * 1024) {
    throw new Error('Logo muito grande. Reduza o arquivo para ate 2 MB.');
  }

  return trimmed;
};

const isBcryptHash = (value) => typeof value === 'string' && (value.startsWith('$2a$') || value.startsWith('$2b$'));

const readBarbershopById = async (id) => {
  const [rows] = await db.query(
    `SELECT ${getBarbershopSelectFields()} FROM barbershops WHERE id = ?`,
    [id],
  );

  if (!rows.length) {
    return null;
  }

  return normalizeBarbershopRow(rows[0]);
};

const ensureOwnBarbershop = (req, res) => {
  const requestedId = Number(req.params.id);
  const authenticatedId = Number(req.barbershop?.id);

  if (!requestedId || requestedId !== authenticatedId) {
    res.status(403).json({ error: 'Voce so pode acessar as configuracoes da sua propria barbearia.' });
    return null;
  }

  return requestedId;
};

const buildBarbershopUpdatePayload = (body) => {
  const updates = {};

  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new Error('Informe o nome da barbearia.');
    if (name.length < 3) throw new Error('O nome da barbearia deve ter pelo menos 3 caracteres.');
    updates.name = name;
  }

  if ('slug' in body) {
    const slug = normalizeSlug(body.slug);
    if (!slug) throw new Error('Informe um slug valido para a URL.');
    updates.slug = slug;
  }

  if ('phone' in body) {
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const digits = phone.replace(/\D/g, '');
    if (phone && (digits.length < 10 || digits.length > 11)) {
      throw new Error('Digite um telefone valido com DDD.');
    }
    updates.phone = phone;
  }

  if ('email' in body) {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email) throw new Error('Informe o e-mail de contato.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Informe um e-mail de contato valido.');
    }
    updates.email = email;
  }

  if ('logo_url' in body) {
    updates.logo_url = normalizeLogoValue(body.logo_url);
  }

  if ('brand_primary_color' in body) {
    const color = normalizeHexColor(body.brand_primary_color, DEFAULT_BRAND_PRIMARY_COLOR);
    if (!color) throw new Error('Cor principal invalida.');
    updates.brand_primary_color = color;
  }

  if ('brand_secondary_color' in body) {
    const color = normalizeHexColor(body.brand_secondary_color, DEFAULT_BRAND_SECONDARY_COLOR);
    if (!color) throw new Error('Cor secundaria invalida.');
    updates.brand_secondary_color = color;
  }

  if ('brand_public_title' in body) {
    const title = typeof body.brand_public_title === 'string' ? body.brand_public_title.trim() : '';
    if (title.length > 60) {
      throw new Error('O titulo publico deve ter no maximo 60 caracteres.');
    }
    updates.brand_public_title = title;
  }

  if ('brand_public_description' in body) {
    const description = typeof body.brand_public_description === 'string'
      ? body.brand_public_description.trim()
      : '';
    if (description.length > 280) {
      throw new Error('A descricao publica deve ter no maximo 280 caracteres.');
    }
    updates.brand_public_description = description;
  }

  if ('notifications_whatsapp_enabled' in body) {
    updates.notifications_whatsapp_enabled = parseBoolean(
      body.notifications_whatsapp_enabled,
      'notifications_whatsapp_enabled',
    );
  }

  if ('notifications_email_enabled' in body) {
    updates.notifications_email_enabled = parseBoolean(
      body.notifications_email_enabled,
      'notifications_email_enabled',
    );
  }

  if ('notifications_reminder_enabled' in body) {
    updates.notifications_reminder_enabled = parseBoolean(
      body.notifications_reminder_enabled,
      'notifications_reminder_enabled',
    );
  }

  if ('notifications_reminder_hours' in body) {
    const hours = Number.parseInt(body.notifications_reminder_hours, 10);
    if (Number.isNaN(hours) || hours < 1 || hours > 72) {
      throw new Error('O lembrete antecipado deve ficar entre 1 e 72 horas.');
    }
    updates.notifications_reminder_hours = hours;
  }

  if ('notifications_daily_summary_enabled' in body) {
    updates.notifications_daily_summary_enabled = parseBoolean(
      body.notifications_daily_summary_enabled,
      'notifications_daily_summary_enabled',
    );
  }

  if ('notifications_daily_summary_time' in body) {
    const summaryTime = normalizeTime(
      body.notifications_daily_summary_time,
      DEFAULT_DAILY_SUMMARY_TIME,
    );
    if (!summaryTime) throw new Error('Horario do resumo diario invalido.');
    updates.notifications_daily_summary_time = summaryTime;
  }

  return updates;
};

const validateNotificationSettings = (currentBarbershop, updates) => {
  const finalState = {
    notifications_whatsapp_enabled: 'notifications_whatsapp_enabled' in updates
      ? updates.notifications_whatsapp_enabled
      : currentBarbershop.notifications_whatsapp_enabled,
    notifications_email_enabled: 'notifications_email_enabled' in updates
      ? updates.notifications_email_enabled
      : currentBarbershop.notifications_email_enabled,
    notifications_reminder_enabled: 'notifications_reminder_enabled' in updates
      ? updates.notifications_reminder_enabled
      : currentBarbershop.notifications_reminder_enabled,
    notifications_daily_summary_enabled: 'notifications_daily_summary_enabled' in updates
      ? updates.notifications_daily_summary_enabled
      : currentBarbershop.notifications_daily_summary_enabled,
  };

  if (!finalState.notifications_whatsapp_enabled && !finalState.notifications_email_enabled) {
    throw new Error('Ative pelo menos um canal de notificacao: WhatsApp ou e-mail.');
  }

  if (finalState.notifications_reminder_enabled) {
    const hours = 'notifications_reminder_hours' in updates
      ? updates.notifications_reminder_hours
      : currentBarbershop.notifications_reminder_hours;

    if (!Number.isInteger(hours) || hours < 1 || hours > 72) {
      throw new Error('O lembrete antecipado deve ficar entre 1 e 72 horas.');
    }
  }

  if (finalState.notifications_daily_summary_enabled) {
    const summaryTime = 'notifications_daily_summary_time' in updates
      ? updates.notifications_daily_summary_time
      : currentBarbershop.notifications_daily_summary_time;

    if (!summaryTime) {
      throw new Error('Defina o horario do resumo diario.');
    }
  }
};

// GET /api/barbershops - PUBLIC: List all barbershops
router.get('/', async (req, res) => {
  try {
    await ensureBarbershopSettingsColumns(db);

    const [rows] = await db.query(
      `SELECT ${getPublicBarbershopSelectFields()} FROM barbershops`,
    );

    res.json(rows.map((row) => normalizeBarbershopRow(row)));
  } catch (err) {
    res.status(500).json({ error: getErrorMessage(err) });
  }
});

// GET /api/barbershops/slug/:slug - PUBLIC: Get a barbershop by slug
router.get('/slug/:slug', async (req, res) => {
  try {
    await ensureBarbershopSettingsColumns(db);

    const [rows] = await db.query(
      `SELECT ${getPublicBarbershopSelectFields()} FROM barbershops WHERE slug = ?`,
      [req.params.slug],
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Barbearia nao encontrada' });
    }

    res.json(normalizeBarbershopRow(rows[0]));
  } catch (err) {
    res.status(500).json({ error: getErrorMessage(err) });
  }
});

// GET /api/barbershops/:id - PROTECTED
router.get('/:id', authenticateToken, async (req, res) => {
  const barbershopId = ensureOwnBarbershop(req, res);
  if (!barbershopId) return;

  try {
    await ensureBarbershopSettingsColumns(db);
    const barbershop = await readBarbershopById(barbershopId);

    if (!barbershop) {
      return res.status(404).json({ error: 'Barbearia nao encontrada' });
    }

    res.json(barbershop);
  } catch (err) {
    res.status(500).json({ error: getErrorMessage(err) });
  }
});

// POST /api/barbershops - PUBLIC: Register a new barbershop
router.post('/', async (req, res) => {
  const { name, slug, phone, email, password } = req.body;

  if (!name || !slug || !email || !password) {
    return res.status(400).json({ error: 'Campos obrigatorios: name, slug, email, password' });
  }

  try {
    await ensureBarbershopSettingsColumns(db);

    const hashedPassword = await bcrypt.hash(password, 12);
    const normalizedName = String(name).trim();
    const normalizedSlug = normalizeSlug(slug);
    const normalizedPhone = typeof phone === 'string' ? phone.trim() : '';
    const normalizedEmail = String(email).trim().toLowerCase();

    if (!normalizedName || normalizedName.length < 3) {
      return res.status(400).json({ error: 'Informe um nome de barbearia com pelo menos 3 caracteres.' });
    }

    if (!normalizedSlug) {
      return res.status(400).json({ error: 'Informe um slug valido.' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Informe um e-mail valido.' });
    }

    const [result] = await db.query(
      `INSERT INTO barbershops (
        name,
        slug,
        phone,
        email,
        password,
        logo_url,
        brand_primary_color,
        brand_secondary_color,
        brand_public_title,
        brand_public_description,
        notifications_whatsapp_enabled,
        notifications_email_enabled,
        notifications_reminder_enabled,
        notifications_reminder_hours,
        notifications_daily_summary_enabled,
        notifications_daily_summary_time,
        password_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        normalizedName,
        normalizedSlug,
        normalizedPhone || null,
        normalizedEmail,
        hashedPassword,
        null,
        DEFAULT_BRAND_PRIMARY_COLOR,
        DEFAULT_BRAND_SECONDARY_COLOR,
        null,
        null,
        1,
        1,
        1,
        DEFAULT_REMINDER_HOURS,
        0,
        DEFAULT_DAILY_SUMMARY_TIME,
      ],
    );

    const createdBarbershop = await readBarbershopById(result.insertId);
    res.status(201).json(createdBarbershop);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Slug ou email ja cadastrado' });
    }

    res.status(500).json({ error: getErrorMessage(err) });
  }
});

// PUT /api/barbershops/:id - PROTECTED
router.put('/:id', authenticateToken, async (req, res) => {
  const barbershopId = ensureOwnBarbershop(req, res);
  if (!barbershopId) return;

  try {
    await ensureBarbershopSettingsColumns(db);

    const currentBarbershop = await readBarbershopById(barbershopId);
    if (!currentBarbershop) {
      return res.status(404).json({ error: 'Barbearia nao encontrada' });
    }

    const updates = buildBarbershopUpdatePayload(req.body);
    validateNotificationSettings(currentBarbershop, updates);

    // Perfil, branding e notificacoes compartilham o mesmo recurso barbershop para que a
    // tela admin tenha uma fonte unica de verdade e reabra sempre com os dados persistidos.
    const assignments = [];
    const values = [];

    Object.entries(updates).forEach(([field, value]) => {
      assignments.push(`${field} = ?`);
      values.push(value);
    });

    const wantsPasswordChange = (
      'current_password' in req.body ||
      'new_password' in req.body ||
      'confirm_new_password' in req.body
    );

    if (wantsPasswordChange) {
      const currentPassword = typeof req.body.current_password === 'string' ? req.body.current_password : '';
      const newPassword = typeof req.body.new_password === 'string' ? req.body.new_password : '';
      const confirmPassword = typeof req.body.confirm_new_password === 'string' ? req.body.confirm_new_password : '';

      if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({ error: 'Informe a senha atual, a nova senha e a confirmacao.' });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
      }

      if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: 'A confirmacao da nova senha nao confere.' });
      }

      if (currentPassword === newPassword) {
        return res.status(400).json({ error: 'A nova senha deve ser diferente da senha atual.' });
      }

      const [rows] = await db.query(
        'SELECT password FROM barbershops WHERE id = ?',
        [barbershopId],
      );

      const storedPassword = rows[0]?.password;
      const passwordIsValid = isBcryptHash(storedPassword)
        ? await bcrypt.compare(currentPassword, storedPassword)
        : currentPassword === storedPassword;

      if (!passwordIsValid) {
        return res.status(400).json({ error: 'A senha atual esta incorreta.' });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 12);
      assignments.push('password = ?');
      values.push(hashedPassword);
      assignments.push('password_updated_at = NOW()');
    }

    if (!assignments.length) {
      return res.json(currentBarbershop);
    }

    values.push(barbershopId);

    await db.query(
      `UPDATE barbershops SET ${assignments.join(', ')} WHERE id = ?`,
      values,
    );

    const updatedBarbershop = await readBarbershopById(barbershopId);
    res.json(updatedBarbershop);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Slug ou email ja cadastrado' });
    }

    if (err instanceof Error) {
      return res.status(400).json({ error: err.message });
    }

    res.status(500).json({ error: getErrorMessage(err) });
  }
});

// DELETE /api/barbershops/:id - PROTECTED
router.delete('/:id', authenticateToken, async (req, res) => {
  const barbershopId = ensureOwnBarbershop(req, res);
  if (!barbershopId) return;

  try {
    const [result] = await db.query('DELETE FROM barbershops WHERE id = ?', [barbershopId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Barbearia nao encontrada' });
    res.json({ message: 'Barbearia removida com sucesso' });
  } catch (err) {
    res.status(500).json({ error: getErrorMessage(err) });
  }
});

module.exports = router;
