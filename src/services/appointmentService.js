// @ts-check
const appointmentRepo = require('../repositories/appointmentRepository');
const serviceRepo = require('../repositories/serviceRepository');
const customerRepo = require('../repositories/customerRepository');
const customerBarbershopRepo = require('../repositories/customerBarbershopRepository');
const barbershopRepo = require('../repositories/barbershopRepository');
const barberRepo = require('../repositories/barberRepository');
const { PRIVACY_POLICY_VERSION, recordConsentLog } = require('../utils/privacy');
const { NotFoundError, ValidationError, ConflictError } = require('../errors/AppError');

const collectServiceItems = (body) => {
  const items = [];
  const seen = new Map();

  const pushItem = (serviceId, quantity) => {
    const id = Number(serviceId);
    const qty = Math.max(1, Math.floor(Number(quantity) || 1));
    if (!Number.isInteger(id) || id <= 0) return;
    if (seen.has(id)) {
      items[seen.get(id)].quantity = qty;
    } else {
      seen.set(id, items.length);
      items.push({ service_id: id, quantity: qty });
    }
  };

  if (Array.isArray(body.service_items)) {
    for (const item of body.service_items) {
      if (item && typeof item === 'object') pushItem(item.service_id, item.quantity);
    }
  }
  if (Array.isArray(body.service_ids)) {
    for (const id of body.service_ids) pushItem(id, 1);
  }
  if (body.service_id != null && !items.length) pushItem(body.service_id, 1);

  return items;
};

const getById = async (db, barbershopId, id) => {
  await appointmentRepo.ensureSchema(db);
  const apt = await appointmentRepo.findById(db, id, barbershopId);
  if (!apt) throw new NotFoundError('Agendamento nao encontrado');
  return apt;
};

const listPrivate = async (db, barbershopId, filters = {}) => {
  await appointmentRepo.ensureSchema(db);
  return appointmentRepo.list(db, barbershopId, filters);
};

const listPublic = async (db, slug, filters) => {
  await appointmentRepo.ensureSchema(db);
  return appointmentRepo.listPublicBySlug(db, slug, filters);
};

const lookupByPhone = async (db, slug, rawPhone) => {
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 11) {
    throw new ValidationError('Informe um telefone valido com DDD.');
  }
  await appointmentRepo.ensureSchema(db);
  return appointmentRepo.lookupByPhone(db, slug, digits);
};

const createPublic = async (db, req, slug, body) => {
  const {
    barber_id, appointment_date, appointment_time,
    customer_name, customer_phone, customer_email,
    privacy_policy_accepted, marketing_consent,
  } = body;

  const serviceItems = collectServiceItems(body);

  if (!barber_id || !serviceItems.length || !appointment_date || !appointment_time || !customer_name || !customer_phone) {
    throw new ValidationError('Campos obrigatorios: barber_id, service_items, appointment_date, appointment_time, customer_name, customer_phone');
  }
  if (!privacy_policy_accepted) {
    throw new ValidationError('Aceite a Politica de Privacidade para continuar.');
  }

  await appointmentRepo.ensureSchema(db);

  const shop = await barbershopRepo.findBySlug(db, slug);
  if (!shop) throw new NotFoundError('Barbearia nao encontrada');

  const barbershopId = shop.id;

  const barber = await barberRepo.findById(db, barber_id, barbershopId);
  if (!barber) throw new ValidationError('Barbeiro invalido para esta barbearia');

  const valid = await serviceRepo.validateItems(db, serviceItems, barbershopId);
  if (!valid) throw new ValidationError('Servico invalido para esta barbearia');

  const digits = String(customer_phone).replace(/\D/g, '');

  let customerId;
  const existing = await customerRepo.findByPhone(db, digits);

  if (existing) {
    customerId = existing.id;
    const linked = await customerBarbershopRepo.isLinked(db, customerId, barbershopId);
    if (linked) {
      await customerBarbershopRepo.updateConsent(db, customerId, barbershopId, {
        privacyVersion: PRIVACY_POLICY_VERSION,
        marketingConsent: marketing_consent,
      });
    } else {
      await customerBarbershopRepo.link(db, customerId, barbershopId, {
        privacyVersion: PRIVACY_POLICY_VERSION,
        marketingConsent: marketing_consent,
      });
    }
  } else {
    customerId = await customerRepo.create(db, {
      name: customer_name, phone: digits, email: customer_email,
    });
    await customerBarbershopRepo.link(db, customerId, barbershopId, {
      privacyVersion: PRIVACY_POLICY_VERSION,
      marketingConsent: marketing_consent,
    });
  }

  await recordConsentLog(db, req, {
    barbershopId, holderType: 'customer', holderId: customerId,
    action: 'privacy_policy_accepted', policyVersion: PRIVACY_POLICY_VERSION,
  });

  const hasConflict = await appointmentRepo.checkConflict(db, barbershopId, barber_id, appointment_date, appointment_time);
  if (hasConflict) throw new ConflictError('Horario ja ocupado para este barbeiro');

  const appointmentId = await appointmentRepo.create(db, {
    barbershopId, barberId: barber_id, customerId,
    principalServiceId: serviceItems[0].service_id,
    date: appointment_date, time: appointment_time,
  });

  await appointmentRepo.replaceServices(db, appointmentId, serviceItems);

  return { id: appointmentId, appointment_date, appointment_time, status: 'pending' };
};

const createPrivate = async (db, barbershopId, body) => {
  const { barber_id, customer_id, appointment_date, appointment_time } = body;
  const serviceItems = collectServiceItems(body);

  if (!barber_id || !customer_id || !serviceItems.length || !appointment_date || !appointment_time) {
    throw new ValidationError('Campos obrigatorios: barber_id, customer_id, service_items, appointment_date, appointment_time');
  }

  await appointmentRepo.ensureSchema(db);

  const [[barberRows], [customerRows]] = await Promise.all([
    db.query('SELECT id FROM barbers WHERE id = ? AND barbershop_id = ? LIMIT 1', [barber_id, barbershopId]),
    db.query(
      'SELECT customer_id FROM customer_barbershops WHERE customer_id = ? AND barbershop_id = ? LIMIT 1',
      [customer_id, barbershopId],
    ),
  ]);

  if (!barberRows.length || !customerRows.length) {
    throw new ValidationError('Barbeiro ou cliente invalido para esta barbearia');
  }

  const valid = await serviceRepo.validateItems(db, serviceItems, barbershopId);
  if (!valid) throw new ValidationError('Servico invalido para esta barbearia');

  const hasConflict = await appointmentRepo.checkConflict(db, barbershopId, barber_id, appointment_date, appointment_time);
  if (hasConflict) throw new ConflictError('Horario ja ocupado para este barbeiro');

  const appointmentId = await appointmentRepo.create(db, {
    barbershopId, barberId: barber_id, customerId: customer_id,
    principalServiceId: serviceItems[0].service_id,
    date: appointment_date, time: appointment_time,
  });

  await appointmentRepo.replaceServices(db, appointmentId, serviceItems);
  return appointmentRepo.findById(db, appointmentId, barbershopId);
};

const updateAppointment = async (db, barbershopId, id, body) => {
  const { barber_id, appointment_date, appointment_time } = body;

  await appointmentRepo.ensureSchema(db);

  const current = await appointmentRepo.getRaw(db, id, barbershopId);
  if (!current) throw new NotFoundError('Agendamento nao encontrado');

  const next = {
    barber_id: barber_id ?? current.barber_id,
    appointment_date: appointment_date ?? current.appointment_date,
    appointment_time: appointment_time ?? current.appointment_time,
  };

  if (next.barber_id !== current.barber_id) {
    const [rows] = await db.query(
      'SELECT id FROM barbers WHERE id = ? AND barbershop_id = ? LIMIT 1',
      [next.barber_id, barbershopId],
    );
    if (!rows.length) throw new ValidationError('Barbeiro invalido para esta barbearia');
  }

  const wantsServiceUpdate = Array.isArray(body.service_items)
    || Array.isArray(body.service_ids)
    || body.service_id != null;

  let nextServiceItems = null;
  if (wantsServiceUpdate) {
    nextServiceItems = collectServiceItems(body);
    if (!nextServiceItems.length) throw new ValidationError('Informe pelo menos um servico.');
    const valid = await serviceRepo.validateItems(db, nextServiceItems, barbershopId);
    if (!valid) throw new ValidationError('Servico invalido para esta barbearia');
  }

  const slotChanged = (
    next.barber_id !== current.barber_id
    || String(next.appointment_date) !== String(current.appointment_date)
    || String(next.appointment_time) !== String(current.appointment_time)
  );

  if (slotChanged) {
    const hasConflict = await appointmentRepo.checkConflict(
      db, barbershopId, next.barber_id, next.appointment_date, next.appointment_time, id,
    );
    if (hasConflict) throw new ConflictError('Horario ja ocupado para este barbeiro');
  }

  const principalServiceId = nextServiceItems ? nextServiceItems[0].service_id : current.service_id;

  await appointmentRepo.update(db, id, barbershopId, {
    barberId: next.barber_id,
    principalServiceId,
    date: next.appointment_date,
    time: next.appointment_time,
  });

  if (nextServiceItems) await appointmentRepo.replaceServices(db, id, nextServiceItems);

  return appointmentRepo.findById(db, id, barbershopId);
};

const updateStatus = async (db, barbershopId, id, status) => {
  const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    throw new ValidationError(`Status invalido. Use: ${validStatuses.join(', ')}`);
  }

  await appointmentRepo.ensureSchema(db);
  const updated = await appointmentRepo.updateStatus(db, id, barbershopId, status);
  if (!updated) throw new NotFoundError('Agendamento nao encontrado');

  return appointmentRepo.findById(db, id, barbershopId);
};

const removeAppointment = async (db, barbershopId, id) => {
  const removed = await appointmentRepo.remove(db, id, barbershopId);
  if (!removed) throw new NotFoundError('Agendamento nao encontrado');
};

module.exports = {
  collectServiceItems,
  getById,
  listPrivate,
  listPublic,
  lookupByPhone,
  createPublic,
  createPrivate,
  updateAppointment,
  updateStatus,
  removeAppointment,
};
