const bcrypt = require('bcryptjs');
const barberRepo = require('../repositories/barberRepository');
const { resolveStorageUrl, getPublicUploadUrl, deleteUploadedFile } = require('../utils/uploads');
const { NotFoundError, ValidationError, ConflictError } = require('../errors/AppError');

const listPublic = async (db, slug) => {
  await barberRepo.ensureSchema(db);
  const rows = await barberRepo.findBySlug(db, slug);
  return Promise.all(rows.map(async (row) => ({
    ...row,
    image_url: await resolveStorageUrl(row.image_url),
  })));
};

const list = async (db, barbershopId) => {
  await barberRepo.ensureSchema(db);
  return barberRepo.list(db, barbershopId);
};

const getById = async (db, barbershopId, id) => {
  await barberRepo.ensureSchema(db);
  const barber = await barberRepo.findById(db, id, barbershopId);
  if (!barber) throw new NotFoundError('Barbeiro nao encontrado');
  return barber;
};

const create = async (db, barbershopId, { name, phone }, file) => {
  if (!name) throw new ValidationError('Campos obrigatorios: name');
  await barberRepo.ensureSchema(db);
  const imageUrl = file ? getPublicUploadUrl('barbers', file) : null;
  return barberRepo.create(db, { barbershopId, name, phone, imageUrl });
};

const update = async (db, barbershopId, id, { name, phone }, file) => {
  await barberRepo.ensureSchema(db);
  const current = await barberRepo.findById(db, id, barbershopId);
  if (!current) throw new NotFoundError('Barbeiro nao encontrado');

  const imageUrl = file ? getPublicUploadUrl('barbers', file) : undefined;
  const updated = await barberRepo.update(db, id, barbershopId, { name, phone, imageUrl });

  if (file && current.image_url) await deleteUploadedFile(current.image_url);

  return updated;
};

const updateCredentials = async (db, barbershopId, id, { email, password }) => {
  if (!email || !password) throw new ValidationError('E-mail e senha sao obrigatorios');
  await barberRepo.ensureSchema(db);

  const barber = await barberRepo.findById(db, id, barbershopId);
  if (!barber) throw new NotFoundError('Barbeiro nao encontrado');

  const hashedPassword = await bcrypt.hash(password, 12);
  try {
    await barberRepo.updateCredentials(db, id, barbershopId, email.trim().toLowerCase(), hashedPassword);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new ConflictError('Este e-mail ja esta em uso por outro barbeiro');
    throw err;
  }
};

const removeBarber = async (db, barbershopId, id) => {
  await barberRepo.ensureSchema(db);
  const barber = await barberRepo.findById(db, id, barbershopId);
  if (!barber) throw new NotFoundError('Barbeiro nao encontrado');

  const removed = await barberRepo.remove(db, id, barbershopId);
  if (!removed) throw new NotFoundError('Barbeiro nao encontrado');

  if (barber.image_url) await deleteUploadedFile(barber.image_url);
};

const removeBarberImage = async (db, barbershopId, id) => {
  await barberRepo.ensureSchema(db);
  const barber = await barberRepo.findById(db, id, barbershopId);
  if (!barber) throw new NotFoundError('Barbeiro nao encontrado');

  const updated = await barberRepo.removeImage(db, id, barbershopId);
  if (barber.image_url) await deleteUploadedFile(barber.image_url);
  return updated;
};

module.exports = {
  listPublic,
  list,
  getById,
  create,
  update,
  updateCredentials,
  removeBarber,
  removeBarberImage,
};
