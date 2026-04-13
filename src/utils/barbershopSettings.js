const DEFAULT_BRAND_PRIMARY_COLOR = '#C9A84C';
const DEFAULT_BRAND_SECONDARY_COLOR = '#F3D58A';
const DEFAULT_REMINDER_HOURS = 2;
const DEFAULT_DAILY_SUMMARY_TIME = '19:00';

const SETTINGS_COLUMNS = [
  { name: 'logo_url', definition: 'LONGTEXT NULL' },
  { name: 'brand_primary_color', definition: "VARCHAR(7) NOT NULL DEFAULT '#C9A84C'" },
  { name: 'brand_secondary_color', definition: "VARCHAR(7) NOT NULL DEFAULT '#F3D58A'" },
  { name: 'brand_public_title', definition: 'VARCHAR(255) NULL' },
  { name: 'brand_public_description', definition: 'TEXT NULL' },
  { name: 'notifications_whatsapp_enabled', definition: 'TINYINT(1) NOT NULL DEFAULT 1' },
  { name: 'notifications_email_enabled', definition: 'TINYINT(1) NOT NULL DEFAULT 1' },
  { name: 'notifications_reminder_enabled', definition: 'TINYINT(1) NOT NULL DEFAULT 1' },
  { name: 'notifications_reminder_hours', definition: 'INT NOT NULL DEFAULT 2' },
  { name: 'notifications_daily_summary_enabled', definition: 'TINYINT(1) NOT NULL DEFAULT 0' },
  { name: 'notifications_daily_summary_time', definition: "VARCHAR(5) NOT NULL DEFAULT '19:00'" },
  { name: 'password_updated_at', definition: 'DATETIME NULL' },
  { name: 'updated_at', definition: 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' },
];

let schemaReadyPromise = null;

const toBoolean = (value, fallback) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true') return true;
    if (normalized === '0' || normalized === 'false') return false;
  }
  return fallback;
};

const normalizeColor = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toUpperCase();
  return /^#([0-9A-F]{3}|[0-9A-F]{6})$/.test(normalized) ? normalized : fallback;
};

const normalizeTime = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(normalized) ? normalized : fallback;
};

const normalizeReminderHours = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isNaN(parsed)) {
    return Math.min(72, Math.max(1, parsed));
  }
  return DEFAULT_REMINDER_HOURS;
};

const getBarbershopSelectFields = (alias = '') => {
  const prefix = alias ? `${alias}.` : '';

  return [
    `${prefix}id`,
    `${prefix}name`,
    `${prefix}slug`,
    `${prefix}phone`,
    `${prefix}email`,
    `${prefix}logo_url`,
    `${prefix}brand_primary_color`,
    `${prefix}brand_secondary_color`,
    `${prefix}brand_public_title`,
    `${prefix}brand_public_description`,
    `${prefix}notifications_whatsapp_enabled`,
    `${prefix}notifications_email_enabled`,
    `${prefix}notifications_reminder_enabled`,
    `${prefix}notifications_reminder_hours`,
    `${prefix}notifications_daily_summary_enabled`,
    `${prefix}notifications_daily_summary_time`,
    `${prefix}password_updated_at`,
    `${prefix}create_at AS created_at`,
    `${prefix}updated_at`,
  ].join(', ');
};

const getPublicBarbershopSelectFields = (alias = '') => {
  const prefix = alias ? `${alias}.` : '';

  return [
    `${prefix}id`,
    `${prefix}name`,
    `${prefix}slug`,
    `${prefix}phone`,
    `${prefix}email`,
    `${prefix}logo_url`,
    `${prefix}brand_primary_color`,
    `${prefix}brand_secondary_color`,
    `${prefix}brand_public_title`,
    `${prefix}brand_public_description`,
    `${prefix}create_at AS created_at`,
    `${prefix}updated_at`,
  ].join(', ');
};

// A rota de configurações precisa funcionar mesmo em bases antigas; por isso os novos campos
// são criados sob demanda antes das consultas que carregam ou persistem essas preferências.
const ensureBarbershopSettingsColumns = async (db) => {
  if (schemaReadyPromise) {
    return schemaReadyPromise;
  }

  schemaReadyPromise = (async () => {
    for (const column of SETTINGS_COLUMNS) {
      const [rows] = await db.query('SHOW COLUMNS FROM barbershops LIKE ?', [column.name]);
      if (!rows.length) {
        await db.query(`ALTER TABLE barbershops ADD COLUMN ${column.name} ${column.definition}`);
      }
    }
  })().catch((error) => {
    schemaReadyPromise = null;
    throw error;
  });

  return schemaReadyPromise;
};

// O backend devolve os mesmos defaults usados pelo front para manter compatibilidade com
// registros criados antes da chegada das novas abas de configuração.
const normalizeBarbershopRow = (row = {}) => ({
  id: Number(row.id || 0),
  name: typeof row.name === 'string' ? row.name : '',
  slug: typeof row.slug === 'string' ? row.slug : '',
  phone: typeof row.phone === 'string' ? row.phone : '',
  email: typeof row.email === 'string' ? row.email : '',
  logo_url: typeof row.logo_url === 'string' && row.logo_url.trim() ? row.logo_url : null,
  brand_primary_color: normalizeColor(row.brand_primary_color, DEFAULT_BRAND_PRIMARY_COLOR),
  brand_secondary_color: normalizeColor(row.brand_secondary_color, DEFAULT_BRAND_SECONDARY_COLOR),
  brand_public_title: typeof row.brand_public_title === 'string' ? row.brand_public_title : '',
  brand_public_description: typeof row.brand_public_description === 'string' ? row.brand_public_description : '',
  notifications_whatsapp_enabled: toBoolean(row.notifications_whatsapp_enabled, true),
  notifications_email_enabled: toBoolean(row.notifications_email_enabled, true),
  notifications_reminder_enabled: toBoolean(row.notifications_reminder_enabled, true),
  notifications_reminder_hours: normalizeReminderHours(row.notifications_reminder_hours),
  notifications_daily_summary_enabled: toBoolean(row.notifications_daily_summary_enabled, false),
  notifications_daily_summary_time: normalizeTime(
    row.notifications_daily_summary_time,
    DEFAULT_DAILY_SUMMARY_TIME,
  ),
  password_updated_at: row.password_updated_at || null,
  created_at: row.created_at || row.create_at || null,
  updated_at: row.updated_at || null,
});

module.exports = {
  DEFAULT_BRAND_PRIMARY_COLOR,
  DEFAULT_BRAND_SECONDARY_COLOR,
  DEFAULT_REMINDER_HOURS,
  DEFAULT_DAILY_SUMMARY_TIME,
  ensureBarbershopSettingsColumns,
  getBarbershopSelectFields,
  getPublicBarbershopSelectFields,
  normalizeBarbershopRow,
};
