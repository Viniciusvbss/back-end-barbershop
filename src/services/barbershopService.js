const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const barbershopRepo = require('../repositories/barbershopRepository');
const {
  ensurePrivacySchema,
  PRIVACY_POLICY_VERSION,
  TERMS_VERSION,
  recordConsentLog,
} = require('../utils/privacy');
const {
  DEFAULT_BRAND_PRIMARY_COLOR,
  DEFAULT_BRAND_SECONDARY_COLOR,
  DEFAULT_DAILY_SUMMARY_TIME,
  DEFAULT_REMINDER_HOURS,
} = require('../utils/barbershopSettings');
const {
  resolveStorageUrl,
  getPublicUploadUrl,
  deleteUploadedFile,
} = require('../utils/uploads');
const { NotFoundError, ValidationError, ConflictError } = require('../errors/AppError');

const isBcryptHash = (v) => typeof v === 'string' && (v.startsWith('$2a$') || v.startsWith('$2b$'));

const parseBoolean = (value, field) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const n = value.trim().toLowerCase();
    if (n === 'true' || n === '1') return true;
    if (n === 'false' || n === '0') return false;
  }
  throw new ValidationError(`Campo invalido: ${field}`);
};

const normalizeHexColor = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const n = value.trim().toUpperCase();
  return /^#([0-9A-F]{3}|[0-9A-F]{6})$/.test(n) ? n : null;
};

const normalizeTime = (value) => {
  if (typeof value !== 'string') return null;
  const n = value.trim();
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(n) ? n : null;
};

const normalizeSlug = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
};

const buildUpdatePayload = (body) => {
  const updates = {};

  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length < 3) throw new ValidationError('O nome da barbearia deve ter pelo menos 3 caracteres.');
    updates.name = name;
  }
  if ('slug' in body) {
    const slug = normalizeSlug(body.slug);
    if (!slug) throw new ValidationError('Informe um slug valido para a URL.');
    updates.slug = slug;
  }
  if ('phone' in body) {
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const digits = phone.replace(/\D/g, '');
    if (phone && (digits.length < 10 || digits.length > 11)) throw new ValidationError('Digite um telefone valido com DDD.');
    updates.phone = phone;
  }
  if ('email' in body) {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('Informe um e-mail de contato valido.');
    updates.email = email;
  }
  if ('brand_primary_color' in body) {
    const color = normalizeHexColor(body.brand_primary_color, DEFAULT_BRAND_PRIMARY_COLOR);
    if (!color) throw new ValidationError('Cor principal invalida.');
    updates.brand_primary_color = color;
  }
  if ('brand_secondary_color' in body) {
    const color = normalizeHexColor(body.brand_secondary_color, DEFAULT_BRAND_SECONDARY_COLOR);
    if (!color) throw new ValidationError('Cor secundaria invalida.');
    updates.brand_secondary_color = color;
  }
  if ('brand_public_title' in body) {
    const title = typeof body.brand_public_title === 'string' ? body.brand_public_title.trim() : '';
    if (title.length > 60) throw new ValidationError('O titulo publico deve ter no maximo 60 caracteres.');
    updates.brand_public_title = title;
  }
  if ('brand_public_description' in body) {
    const desc = typeof body.brand_public_description === 'string' ? body.brand_public_description.trim() : '';
    if (desc.length > 280) throw new ValidationError('A descricao publica deve ter no maximo 280 caracteres.');
    updates.brand_public_description = desc;
  }
  if ('notifications_whatsapp_enabled' in body) {
    updates.notifications_whatsapp_enabled = parseBoolean(body.notifications_whatsapp_enabled, 'notifications_whatsapp_enabled');
  }
  if ('notifications_email_enabled' in body) {
    updates.notifications_email_enabled = parseBoolean(body.notifications_email_enabled, 'notifications_email_enabled');
  }
  if ('notifications_reminder_enabled' in body) {
    updates.notifications_reminder_enabled = parseBoolean(body.notifications_reminder_enabled, 'notifications_reminder_enabled');
  }
  if ('notifications_reminder_hours' in body) {
    const hours = Number.parseInt(body.notifications_reminder_hours, 10);
    if (Number.isNaN(hours) || hours < 1 || hours > 72) throw new ValidationError('O lembrete antecipado deve ficar entre 1 e 72 horas.');
    updates.notifications_reminder_hours = hours;
  }
  if ('notifications_daily_summary_enabled' in body) {
    updates.notifications_daily_summary_enabled = parseBoolean(body.notifications_daily_summary_enabled, 'notifications_daily_summary_enabled');
  }
  if ('notifications_daily_summary_time' in body) {
    const t = normalizeTime(body.notifications_daily_summary_time);
    if (!t) throw new ValidationError('Horario do resumo diario invalido.');
    updates.notifications_daily_summary_time = t;
  }

  return updates;
};

const validateNotificationSettings = (current, updates) => {
  const final = {
    notifications_whatsapp_enabled: 'notifications_whatsapp_enabled' in updates ? updates.notifications_whatsapp_enabled : current.notifications_whatsapp_enabled,
    notifications_email_enabled: 'notifications_email_enabled' in updates ? updates.notifications_email_enabled : current.notifications_email_enabled,
    notifications_reminder_enabled: 'notifications_reminder_enabled' in updates ? updates.notifications_reminder_enabled : current.notifications_reminder_enabled,
    notifications_daily_summary_enabled: 'notifications_daily_summary_enabled' in updates ? updates.notifications_daily_summary_enabled : current.notifications_daily_summary_enabled,
  };

  if (!final.notifications_whatsapp_enabled && !final.notifications_email_enabled) {
    throw new ValidationError('Ative pelo menos um canal de notificacao: WhatsApp ou e-mail.');
  }
  if (final.notifications_reminder_enabled) {
    const hours = 'notifications_reminder_hours' in updates ? updates.notifications_reminder_hours : current.notifications_reminder_hours;
    if (!Number.isInteger(hours) || hours < 1 || hours > 72) throw new ValidationError('O lembrete antecipado deve ficar entre 1 e 72 horas.');
  }
  if (final.notifications_daily_summary_enabled) {
    const t = 'notifications_daily_summary_time' in updates ? updates.notifications_daily_summary_time : current.notifications_daily_summary_time;
    if (!t) throw new ValidationError('Defina o horario do resumo diario.');
  }
};

const list = (db) => barbershopRepo.list(db);

const getBySlug = async (db, slug) => {
  const shop = await barbershopRepo.findBySlug(db, slug);
  if (!shop) throw new NotFoundError('Barbearia nao encontrada');
  shop.logo_url = await resolveStorageUrl(shop.logo_url);
  return shop;
};

const getById = async (db, id) => {
  const shop = await barbershopRepo.findById(db, id);
  if (!shop) throw new NotFoundError('Barbearia nao encontrada');
  return shop;
};

const register = async (db, req, { name, slug, phone, email, password, privacy_policy_accepted, terms_accepted }) => {
  if (!name || !slug || !email || !password) throw new ValidationError('Campos obrigatorios: name, slug, email, password');
  if (!privacy_policy_accepted || !terms_accepted) throw new ValidationError('Aceite os Termos de Uso e a Politica de Privacidade para continuar.');

  await ensurePrivacySchema(db);

  const normalizedName = String(name).trim();
  const normalizedSlug = normalizeSlug(slug);
  const normalizedEmail = String(email).trim().toLowerCase();

  if (!normalizedName || normalizedName.length < 3) throw new ValidationError('Informe um nome de barbearia com pelo menos 3 caracteres.');
  if (!normalizedSlug) throw new ValidationError('Informe um slug valido.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new ValidationError('Informe um e-mail valido.');

  const hashedPassword = await bcrypt.hash(password, 12);

  let insertId;
  try {
    insertId = await barbershopRepo.create(db, {
      name: normalizedName, uuid: crypto.randomUUID(), slug: normalizedSlug,
      phone: typeof phone === 'string' ? phone.trim() : null,
      email: normalizedEmail, password: hashedPassword,
      primaryColor: DEFAULT_BRAND_PRIMARY_COLOR,
      secondaryColor: DEFAULT_BRAND_SECONDARY_COLOR,
      reminderHours: DEFAULT_REMINDER_HOURS,
      dailySummaryTime: DEFAULT_DAILY_SUMMARY_TIME,
      privacyVersion: PRIVACY_POLICY_VERSION, termsVersion: TERMS_VERSION,
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new ConflictError('Slug ou email ja cadastrado');
    throw err;
  }

  await recordConsentLog(db, req, {
    barbershopId: insertId, holderType: 'barbershop', holderId: insertId,
    action: 'terms_and_privacy_accepted',
    policyVersion: PRIVACY_POLICY_VERSION, termsVersion: TERMS_VERSION,
  });

  return barbershopRepo.findById(db, insertId);
};

const update = async (db, id, body, current) => {
  const updates = buildUpdatePayload(body);
  validateNotificationSettings(current, updates);

  const wantsPasswordChange = 'current_password' in body || 'new_password' in body || 'confirm_new_password' in body;
  if (wantsPasswordChange) {
    const currentPwd = typeof body.current_password === 'string' ? body.current_password : '';
    const newPwd = typeof body.new_password === 'string' ? body.new_password : '';
    const confirmPwd = typeof body.confirm_new_password === 'string' ? body.confirm_new_password : '';

    if (!currentPwd || !newPwd || !confirmPwd) throw new ValidationError('Informe a senha atual, a nova senha e a confirmacao.');
    if (newPwd.length < 6) throw new ValidationError('A nova senha deve ter pelo menos 6 caracteres.');
    if (newPwd !== confirmPwd) throw new ValidationError('A confirmacao da nova senha nao confere.');
    if (currentPwd === newPwd) throw new ValidationError('A nova senha deve ser diferente da senha atual.');

    const [rows] = await db.query('SELECT password FROM barbershops WHERE id = ?', [id]);
    const stored = rows[0]?.password;
    const valid = isBcryptHash(stored) ? await bcrypt.compare(currentPwd, stored) : currentPwd === stored;
    if (!valid) throw new ValidationError('A senha atual esta incorreta.');

    updates.password = await bcrypt.hash(newPwd, 12);
    updates.password_updated_at = new Date();
  }

  if (!Object.keys(updates).length) return current;

  const assignments = [];
  const values = [];
  Object.entries(updates).forEach(([field, value]) => {
    if (field === 'password_updated_at') {
      assignments.push('password_updated_at = NOW()');
    } else {
      assignments.push(`${field} = ?`);
      values.push(value);
    }
  });

  try {
    await barbershopRepo.update(db, id, assignments, values);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new ConflictError('Slug ou email ja cadastrado');
    throw err;
  }

  return barbershopRepo.findById(db, id);
};

const uploadLogo = async (db, id, file) => {
  const current = await barbershopRepo.findById(db, id);
  if (!current) throw new NotFoundError('Barbearia nao encontrada');

  const nextLogoUrl = getPublicUploadUrl('barbershops', file);
  await barbershopRepo.updateLogo(db, id, nextLogoUrl);
  await deleteUploadedFile(current.logo_url);

  return barbershopRepo.findById(db, id);
};

const removeLogo = async (db, id) => {
  const current = await barbershopRepo.findById(db, id);
  if (!current) throw new NotFoundError('Barbearia nao encontrada');

  await barbershopRepo.removeLogo(db, id);
  await deleteUploadedFile(current.logo_url);

  return barbershopRepo.findById(db, id);
};

const removeBarbershop = async (db, id) => {
  const logoUrl = await barbershopRepo.getLogo(db, id);
  const barberImages = await barbershopRepo.getBarberImages(db, id);

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const removed = await barbershopRepo.remove(db, connection, id);
    if (!removed) {
      await connection.rollback();
      throw new NotFoundError('Barbearia nao encontrada');
    }
    await connection.commit();

    await Promise.all([
      deleteUploadedFile(logoUrl),
      ...barberImages.map((url) => deleteUploadedFile(url)),
    ]);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

module.exports = {
  list,
  getBySlug,
  getById,
  register,
  update,
  uploadLogo,
  removeLogo,
  removeBarbershop,
};
