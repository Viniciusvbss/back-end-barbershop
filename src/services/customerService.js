const customerRepo = require('../repositories/customerRepository');
const { recordConsentLog } = require('../utils/privacy');
const { NotFoundError, ValidationError } = require('../errors/AppError');

const list = (db, barbershopId) => customerRepo.list(db, barbershopId);

const getById = async (db, barbershopId, id) => {
  const customer = await customerRepo.findById(db, id, barbershopId);
  if (!customer) throw new NotFoundError('Cliente nao encontrado');
  return customer;
};

const create = async (db, barbershopId, { name, phone, email, marketing_consent }) => {
  if (!name) throw new ValidationError('Campos obrigatorios: name');
  await customerRepo.ensureSchema(db);
  const id = await customerRepo.create(db, {
    barbershopId, name, phone, email,
    marketingConsent: marketing_consent,
    privacyVersion: null,
  });
  return { id, barbershop_id: barbershopId, name };
};

const update = async (db, barbershopId, id, { name, phone, email, marketing_consent }) => {
  await customerRepo.ensureSchema(db);
  const updated = await customerRepo.update(db, id, barbershopId, { name, phone, email, marketingConsent: marketing_consent });
  if (!updated) throw new NotFoundError('Cliente nao encontrado');
  return updated;
};

const remove = async (db, barbershopId, id) => {
  const removed = await customerRepo.remove(db, id, barbershopId);
  if (!removed) throw new NotFoundError('Cliente nao encontrado');
};

const anonymize = async (db, req, barbershopId, id) => {
  await customerRepo.ensureSchema(db);
  const removed = await customerRepo.anonymize(db, id, barbershopId);
  if (!removed) throw new NotFoundError('Cliente nao encontrado');

  await recordConsentLog(db, req, {
    barbershopId, holderType: 'customer', holderId: Number(id),
    action: 'customer_anonymized', policyVersion: null,
  });
};

const exportData = async (db, barbershopId, id) => {
  await customerRepo.ensureSchema(db);
  const data = await customerRepo.exportData(db, id, barbershopId);
  if (!data) throw new NotFoundError('Cliente nao encontrado');
  return data;
};

module.exports = { list, getById, create, update, remove, anonymize, exportData };
