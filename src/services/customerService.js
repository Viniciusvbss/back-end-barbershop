const customerRepo = require('../repositories/customerRepository');
const customerBarbershopRepo = require('../repositories/customerBarbershopRepository');
const { recordConsentLog } = require('../utils/privacy');
const { NotFoundError, ValidationError } = require('../errors/AppError');

const list = (db, barbershopId, pagination = {}) =>
  customerRepo.list(db, barbershopId, pagination);

const getById = async (db, barbershopId, id) => {
  const customer = await customerRepo.findById(db, id, barbershopId);
  if (!customer) throw new NotFoundError('Cliente nao encontrado');
  return customer;
};

const create = async (db, barbershopId, { name, phone, email, marketing_consent }) => {
  if (!name) throw new ValidationError('Campos obrigatorios: name');

  // Reutiliza cliente global se o telefone já existir
  let existing = null;
  if (phone) {
    const digits = String(phone).replace(/\D/g, '');
    existing = await customerRepo.findByPhone(db, digits);
  }

  let customerId;
  if (existing) {
    customerId = existing.id;
    const linked = await customerBarbershopRepo.isLinked(db, customerId, barbershopId);
    if (linked) return getById(db, barbershopId, customerId);
  } else {
    customerId = await customerRepo.create(db, {
      name,
      phone: phone ? String(phone).replace(/\D/g, '') : null,
      email: email || null,
    });
  }

  await customerBarbershopRepo.link(db, customerId, barbershopId, {
    marketingConsent: marketing_consent,
    privacyVersion: null,
  });

  return getById(db, barbershopId, customerId);
};

const update = async (db, barbershopId, id, { name, phone, email, marketing_consent }) => {
  const updated = await customerRepo.update(db, id, barbershopId, {
    name, phone, email, marketingConsent: marketing_consent,
  });
  if (!updated) throw new NotFoundError('Cliente nao encontrado');
  return updated;
};

// Desvincula o cliente desta barbearia (não exclui o registro global)
const remove = async (db, barbershopId, id) => {
  const removed = await customerRepo.remove(db, id, barbershopId);
  if (!removed) throw new NotFoundError('Cliente nao encontrado');
};

const anonymize = async (db, req, barbershopId, id) => {
  const removed = await customerRepo.anonymize(db, id, barbershopId);
  if (!removed) throw new NotFoundError('Cliente nao encontrado');

  await recordConsentLog(db, req, {
    barbershopId, holderType: 'customer', holderId: Number(id),
    action: 'customer_anonymized', policyVersion: null,
  });
};

const exportData = async (db, barbershopId, id) => {
  const data = await customerRepo.exportData(db, id, barbershopId);
  if (!data) throw new NotFoundError('Cliente nao encontrado');
  return data;
};

// ---- rotas /me (cliente autenticado) ----

const getMyProfile = async (db, customerId) => {
  const customer = await customerRepo.findByIdGlobal(db, customerId);
  if (!customer) throw new NotFoundError('Cliente nao encontrado');
  const barbershops = await customerBarbershopRepo.listByCustomer(db, customerId);
  return { ...customer, barbershops };
};

const updateMyProfile = async (db, customerId, { name, phone }) => {
  if (!name && !phone) throw new ValidationError('Informe name ou phone para atualizar.');
  await db.query(
    `UPDATE customers SET
       name  = COALESCE(NULLIF(?, ''), name),
       phone = COALESCE(NULLIF(?, ''), phone),
       updated_at = NOW()
     WHERE id = ?`,
    [name || null, phone ? String(phone).replace(/\D/g, '') : null, customerId],
  );
  return customerRepo.findByIdGlobal(db, customerId);
};

const getFavorites = async (db, customerId) => {
  const [rows] = await db.query(`
    SELECT bs.id, bs.name, bs.slug, bs.logo_url
    FROM customer_favorites cf
    JOIN barbershops bs ON bs.id = cf.barbershop_id
    WHERE cf.customer_id = ?
    ORDER BY cf.created_at DESC
  `, [customerId]);
  return rows;
};

const addFavorite = async (db, customerId, barbershopId) => {
  await db.query(
    'INSERT IGNORE INTO customer_favorites (customer_id, barbershop_id) VALUES (?, ?)',
    [customerId, barbershopId],
  );
};

const removeFavorite = async (db, customerId, barbershopId) => {
  await db.query(
    'DELETE FROM customer_favorites WHERE customer_id = ? AND barbershop_id = ?',
    [customerId, barbershopId],
  );
};

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
  anonymize,
  exportData,
  getMyProfile,
  updateMyProfile,
  getFavorites,
  addFavorite,
  removeFavorite,
};
