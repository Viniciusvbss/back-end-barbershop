// @ts-check
const appointmentRepo = require('../repositories/appointmentRepository');
const serviceRepo = require('../repositories/serviceRepository');
const customerRepo = require('../repositories/customerRepository');
const customerBarbershopRepo = require('../repositories/customerBarbershopRepository');
const barbershopRepo = require('../repositories/barbershopRepository');
const barberRepo = require('../repositories/barberRepository');
const businessHoursRepo = require('../repositories/businessHoursRepository');
const { PRIVACY_POLICY_VERSION, recordConsentLog } = require('../utils/privacy');
const { NotFoundError, ValidationError, ConflictError } = require('../errors/AppError');

const SLOT_CONFLICT_MESSAGE = 'Horario ja ocupado para este barbeiro';

const toMinutes = (value) => {
  const [hour, minute] = String(value).split(':').map(Number);
  return (hour * 60) + (minute || 0);
};

// Weekday em UTC: 'YYYY-MM-DD' interpretado no fuso local renderia o dia anterior
// em quem roda a oeste de Greenwich. 0 = domingo, igual a business_hours.weekday.
// O body manda string; o getRaw devolve Date (o pool le DATE como meia-noite UTC).
const weekdayOf = (date) => {
  if (date instanceof Date) return date.getUTCDay();
  const [year, month, day] = String(date).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

// Barbearia sem business_hours cadastrado nao tem janela para validar — deixa
// passar, senao bloquearia todo agendamento de quem nunca preencheu a agenda.
const assertWithinBusinessHours = (hours, date, time, durationMinutes) => {
  if (!hours.length) return;

  const today = hours.find((row) => Number(row.weekday) === weekdayOf(date));
  if (!today) throw new ValidationError('A barbearia nao atende neste dia da semana.');

  const open = toMinutes(today.open_time);
  const close = toMinutes(today.close_time);
  const start = toMinutes(time);

  if (start < open || start + durationMinutes > close) {
    throw new ValidationError(
      `Horario fora do funcionamento da barbearia (${String(today.open_time).slice(0, 5)} as ${String(today.close_time).slice(0, 5)}).`,
    );
  }
};

// checkConflict resolve o caso normal, mas duas requisicoes simultaneas passam as
// duas por ele antes de qualquer uma gravar. O indice uk_apt_barber_slot (migration
// 006) barra a segunda no banco; aqui o ER_DUP_ENTRY vira o mesmo 409 do check.
const asSlotConflict = (err) => (
  err.code === 'ER_DUP_ENTRY' && String(err.message).includes('uk_apt_barber_slot')
    ? new ConflictError(SLOT_CONFLICT_MESSAGE)
    : err
);

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

  const durationMinutes = await serviceRepo.totalDurationForItems(db, serviceItems, barbershopId);
  if (durationMinutes === null) throw new ValidationError('Servico invalido para esta barbearia');

  assertWithinBusinessHours(
    await businessHoursRepo.findBySlug(db, slug),
    appointment_date, appointment_time, durationMinutes,
  );

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

  const hasConflict = await appointmentRepo.checkConflict(
    db, barbershopId, barber_id, appointment_date, appointment_time, durationMinutes,
  );
  if (hasConflict) throw new ConflictError(SLOT_CONFLICT_MESSAGE);

  let appointmentId;
  try {
    appointmentId = await appointmentRepo.create(db, {
      barbershopId, barberId: barber_id, customerId,
      principalServiceId: serviceItems[0].service_id,
      date: appointment_date, time: appointment_time,
    });
  } catch (err) {
    throw asSlotConflict(err);
  }

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

  const durationMinutes = await serviceRepo.totalDurationForItems(db, serviceItems, barbershopId);
  if (durationMinutes === null) throw new ValidationError('Servico invalido para esta barbearia');

  assertWithinBusinessHours(
    await businessHoursRepo.list(db, barbershopId),
    appointment_date, appointment_time, durationMinutes,
  );

  const hasConflict = await appointmentRepo.checkConflict(
    db, barbershopId, barber_id, appointment_date, appointment_time, durationMinutes,
  );
  if (hasConflict) throw new ConflictError(SLOT_CONFLICT_MESSAGE);

  let appointmentId;
  try {
    appointmentId = await appointmentRepo.create(db, {
      barbershopId, barberId: barber_id, customerId: customer_id,
      principalServiceId: serviceItems[0].service_id,
      date: appointment_date, time: appointment_time,
    });
  } catch (err) {
    throw asSlotConflict(err);
  }

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
  let durationMinutes;
  if (wantsServiceUpdate) {
    nextServiceItems = collectServiceItems(body);
    if (!nextServiceItems.length) throw new ValidationError('Informe pelo menos um servico.');
    durationMinutes = await serviceRepo.totalDurationForItems(db, nextServiceItems, barbershopId);
    if (durationMinutes === null) throw new ValidationError('Servico invalido para esta barbearia');
  } else {
    durationMinutes = await appointmentRepo.durationOf(db, id);
  }

  const slotChanged = (
    next.barber_id !== current.barber_id
    || String(next.appointment_date) !== String(current.appointment_date)
    || String(next.appointment_time) !== String(current.appointment_time)
  );

  // Trocar de servico sem mudar o horario tambem reabre a checagem: um servico mais
  // longo comeca na mesma hora, mas termina em cima do agendamento seguinte.
  if (slotChanged || wantsServiceUpdate) {
    assertWithinBusinessHours(
      await businessHoursRepo.list(db, barbershopId),
      next.appointment_date, next.appointment_time, durationMinutes,
    );

    const hasConflict = await appointmentRepo.checkConflict(
      db, barbershopId, next.barber_id, next.appointment_date, next.appointment_time,
      durationMinutes, id,
    );
    if (hasConflict) throw new ConflictError(SLOT_CONFLICT_MESSAGE);
  }

  const principalServiceId = nextServiceItems ? nextServiceItems[0].service_id : current.service_id;

  try {
    await appointmentRepo.update(db, id, barbershopId, {
      barberId: next.barber_id,
      principalServiceId,
      date: next.appointment_date,
      time: next.appointment_time,
    });
  } catch (err) {
    throw asSlotConflict(err);
  }

  if (nextServiceItems) await appointmentRepo.replaceServices(db, id, nextServiceItems);

  return appointmentRepo.findById(db, id, barbershopId);
};

const updateStatus = async (db, barbershopId, id, status) => {
  const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    throw new ValidationError(`Status invalido. Use: ${validStatuses.join(', ')}`);
  }

  await appointmentRepo.ensureSchema(db);

  // Tirar um agendamento de 'cancelled' devolve ele ao indice: se o horario ja
  // foi ocupado por outro cliente nesse meio tempo, o UPDATE bate no UNIQUE.
  let updated;
  try {
    updated = await appointmentRepo.updateStatus(db, id, barbershopId, status);
  } catch (err) {
    throw asSlotConflict(err);
  }
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
