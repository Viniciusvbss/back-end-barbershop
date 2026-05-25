const businessHoursRepo = require('../repositories/businessHoursRepository');
const { NotFoundError, ValidationError } = require('../errors/AppError');

const listPublic = (db, slug) => businessHoursRepo.findBySlug(db, slug);

const list = (db, barbershopId) => businessHoursRepo.list(db, barbershopId);

const getById = async (db, barbershopId, id) => {
  const bh = await businessHoursRepo.findById(db, id, barbershopId);
  if (!bh) throw new NotFoundError('Horario nao encontrado');
  return bh;
};

const create = async (db, barbershopId, { weekday, open_time, close_time }) => {
  if (weekday === undefined || !open_time || !close_time) {
    throw new ValidationError('Campos obrigatorios: weekday (0-6), open_time, close_time');
  }
  if (weekday < 0 || weekday > 6) throw new ValidationError('weekday deve ser entre 0 (Domingo) e 6 (Sabado)');
  return businessHoursRepo.create(db, { barbershopId, weekday, openTime: open_time, closeTime: close_time });
};

const update = async (db, barbershopId, id, { weekday, open_time, close_time }) => {
  const updated = await businessHoursRepo.update(db, id, barbershopId, { weekday, openTime: open_time, closeTime: close_time });
  if (!updated) throw new NotFoundError('Horario nao encontrado');
};

const remove = async (db, barbershopId, id) => {
  const removed = await businessHoursRepo.remove(db, id, barbershopId);
  if (!removed) throw new NotFoundError('Horario nao encontrado');
};

module.exports = { listPublic, list, getById, create, update, remove };
