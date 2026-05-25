const serviceRepo = require('../repositories/serviceRepository');
const { NotFoundError, ValidationError } = require('../errors/AppError');

const listPublic = (db, slug) => serviceRepo.findBySlug(db, slug);

const list = (db, barbershopId) => serviceRepo.list(db, barbershopId);

const getById = async (db, barbershopId, id) => {
  const service = await serviceRepo.findById(db, id, barbershopId);
  if (!service) throw new NotFoundError('Servico nao encontrado');
  return service;
};

const create = async (db, barbershopId, { name, duration_minutes, price }) => {
  if (!name || duration_minutes == null || price === undefined) {
    throw new ValidationError('Campos obrigatorios: name, duration_minutes, price');
  }
  if (Number(duration_minutes) < 0) throw new ValidationError('duration_minutes nao pode ser negativo');
  return serviceRepo.create(db, { barbershopId, name, durationMinutes: duration_minutes, price });
};

const update = async (db, barbershopId, id, { name, duration_minutes, price }) => {
  if (duration_minutes != null && Number(duration_minutes) < 0) {
    throw new ValidationError('duration_minutes nao pode ser negativo');
  }
  const updated = await serviceRepo.update(db, id, barbershopId, { name, durationMinutes: duration_minutes, price });
  if (!updated) throw new NotFoundError('Servico nao encontrado');
  return updated;
};

const remove = async (db, barbershopId, id) => {
  const removed = await serviceRepo.remove(db, id, barbershopId);
  if (!removed) throw new NotFoundError('Servico nao encontrado');
};

module.exports = { listPublic, list, getById, create, update, remove };
