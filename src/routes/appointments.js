const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');
const { PRIVACY_POLICY_VERSION, ensurePrivacySchema, recordConsentLog } = require('../utils/privacy');

// Schema many-to-many entre appointments e services. Criado sob demanda
// (mesmo padrão dos outros ensure* do projeto). Backfill imediato copia
// o appointments.service_id atual como primeiro serviço de cada
// agendamento existente.
let appointmentServicesSchemaReady = null;
const ensureAppointmentServicesSchema = async () => {
  if (appointmentServicesSchemaReady) return appointmentServicesSchemaReady;

  appointmentServicesSchemaReady = (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS appointment_services (
        appointment_id INT NOT NULL,
        service_id INT NOT NULL,
        position INT NOT NULL DEFAULT 0,
        quantity INT NOT NULL DEFAULT 1,
        PRIMARY KEY (appointment_id, service_id),
        INDEX idx_aps_appointment (appointment_id),
        CONSTRAINT fk_aps_appointment
          FOREIGN KEY (appointment_id) REFERENCES appointments(id)
          ON DELETE CASCADE,
        CONSTRAINT fk_aps_service
          FOREIGN KEY (service_id) REFERENCES services(id)
          ON DELETE RESTRICT
      )
    `);

    // Bases que já tinham a tabela podem não ter `quantity` ainda.
    const [columns] = await db.query('SHOW COLUMNS FROM appointment_services LIKE ?', ['quantity']);
    if (!columns.length) {
      await db.query('ALTER TABLE appointment_services ADD COLUMN quantity INT NOT NULL DEFAULT 1');
    }

    await db.query(`
      INSERT IGNORE INTO appointment_services (appointment_id, service_id, position, quantity)
      SELECT id, service_id, 0, 1
      FROM appointments
      WHERE service_id IS NOT NULL
    `);
  })().catch((error) => {
    appointmentServicesSchemaReady = null;
    throw error;
  });

  return appointmentServicesSchemaReady;
};

// SELECT canônico com agregação dos serviços. `service_name` continua existindo
// (concatenado com " + ") para não quebrar consumidores que esperam um único
// nome legível, e `services` traz a lista detalhada para o front exibir.
const APPOINTMENT_SELECT = `
  a.id, a.barbershop_id, a.barber_id, a.customer_id, a.service_id,
  a.appointment_date, a.appointment_time, a.status, a.created_at,
  c.name AS customer_name, c.phone AS customer_phone,
  b.name AS barber_name, b.image_url AS barber_image_url,
  GROUP_CONCAT(
    CASE WHEN aps.quantity > 1 THEN CONCAT(s.name, ' ×', aps.quantity) ELSE s.name END
    ORDER BY aps.position, s.id SEPARATOR ' + '
  ) AS service_name,
  COALESCE(SUM(s.duration_minutes * aps.quantity), 0) AS duration_minutes,
  COALESCE(SUM(s.price * aps.quantity), 0) AS price,
  CONCAT('[',
    GROUP_CONCAT(
      JSON_OBJECT(
        'id', s.id,
        'name', s.name,
        'duration_minutes', s.duration_minutes,
        'price', s.price,
        'quantity', aps.quantity
      )
      ORDER BY aps.position, s.id
      SEPARATOR ','
    ),
    ']'
  ) AS services
`;

const APPOINTMENT_JOINS = `
  FROM appointments a
  JOIN customers c ON a.customer_id = c.id
  JOIN barbers b ON a.barber_id = b.id
  LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
  LEFT JOIN services s ON s.id = aps.service_id
`;

const APPOINTMENT_GROUP_BY = `
  GROUP BY a.id, a.barbershop_id, a.barber_id, a.customer_id, a.service_id,
           a.appointment_date, a.appointment_time, a.status, a.created_at,
           c.name, c.phone, b.name, b.image_url
`;

const normalizeAppointmentRow = (row) => {
  if (!row) return row;
  let services = row.services;
  if (typeof services === 'string') {
    try {
      services = JSON.parse(services);
    } catch {
      services = [];
    }
  }
  return {
    ...row,
    services: Array.isArray(services) ? services.filter((s) => s && s.id) : [],
    duration_minutes: Number(row.duration_minutes ?? 0),
    price: row.price != null ? String(row.price) : null,
  };
};

const fetchAppointmentById = async (id, barbershopId) => {
  const [rows] = await db.query(
    `SELECT ${APPOINTMENT_SELECT}
     ${APPOINTMENT_JOINS}
     WHERE a.id = ? AND a.barbershop_id = ?
     ${APPOINTMENT_GROUP_BY}`,
    [id, barbershopId],
  );
  return rows.length ? normalizeAppointmentRow(rows[0]) : null;
};

// Normaliza o payload de serviços para um array `[{service_id, quantity}]`.
// Aceita os formatos:
//   service_items: [{ service_id, quantity }]   (preferencial)
//   service_ids:   [1, 2, 3]                    (legacy, quantity=1 implícito)
//   service_id:    1                            (legacy mono-serviço)
// Deduplica pelo service_id (último ganha) e descarta entradas inválidas.
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

const validateServiceItems = async (items, barbershopId) => {
  if (!items.length) return false;
  const ids = items.map((item) => item.service_id);
  const placeholders = ids.map(() => '?').join(', ');
  const [rows] = await db.query(
    `SELECT id FROM services WHERE id IN (${placeholders}) AND barbershop_id = ?`,
    [...ids, barbershopId],
  );
  return rows.length === ids.length;
};

const replaceAppointmentServices = async (appointmentId, items) => {
  await db.query('DELETE FROM appointment_services WHERE appointment_id = ?', [appointmentId]);
  if (!items.length) return;
  const values = items.map((item, idx) => [appointmentId, item.service_id, idx, item.quantity]);
  await db.query(
    'INSERT INTO appointment_services (appointment_id, service_id, position, quantity) VALUES ?',
    [values],
  );
};

router.get('/public/:slug', async (req, res) => {
  const { barber_id, date, status } = req.query;
  try {
    await ensureAppointmentServicesSchema();

    let query = `
      SELECT
        a.id, a.appointment_date, a.appointment_time, a.status, a.created_at,
        b.name AS barber_name, b.image_url AS barber_image_url,
        GROUP_CONCAT(
          CASE WHEN aps.quantity > 1 THEN CONCAT(s.name, ' ×', aps.quantity) ELSE s.name END
          ORDER BY aps.position, s.id SEPARATOR ' + '
        ) AS service_name,
        COALESCE(SUM(s.duration_minutes * aps.quantity), 0) AS duration_minutes,
        COALESCE(SUM(s.price * aps.quantity), 0) AS price,
        CONCAT('[',
          GROUP_CONCAT(
            JSON_OBJECT('id', s.id, 'name', s.name, 'duration_minutes', s.duration_minutes, 'price', s.price, 'quantity', aps.quantity)
            ORDER BY aps.position, s.id SEPARATOR ','
          ),
        ']') AS services
      FROM appointments a
      JOIN barbershops bs ON a.barbershop_id = bs.id
      JOIN barbers b ON a.barber_id = b.id
      LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
      LEFT JOIN services s ON s.id = aps.service_id
      WHERE bs.slug = ?
    `;
    const params = [req.params.slug];

    if (barber_id) { query += ' AND a.barber_id = ?'; params.push(barber_id); }
    if (date) { query += ' AND a.appointment_date = ?'; params.push(date); }
    if (status) { query += ' AND a.status = ?'; params.push(status); }

    query += `
      GROUP BY a.id, a.appointment_date, a.appointment_time, a.status, a.created_at,
               b.name, b.image_url
      ORDER BY a.appointment_date, a.appointment_time
    `;

    const [rows] = await db.query(query, params);
    res.json(rows.map(normalizeAppointmentRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/public/:slug/lookup', async (req, res) => {
  const rawPhone = typeof req.body.phone === 'string' ? req.body.phone : '';
  const digits = rawPhone.replace(/\D/g, '');

  if (digits.length < 10 || digits.length > 11) {
    return res.status(400).json({ error: 'Informe um telefone valido com DDD.' });
  }

  try {
    await ensureAppointmentServicesSchema();

    const [rows] = await db.query(
      `SELECT
         a.id, a.appointment_date, a.appointment_time, a.status, a.created_at,
         c.name AS customer_name,
         b.name AS barber_name, b.image_url AS barber_image_url,
         GROUP_CONCAT(
           CASE WHEN aps.quantity > 1 THEN CONCAT(s.name, ' ×', aps.quantity) ELSE s.name END
           ORDER BY aps.position, s.id SEPARATOR ' + '
         ) AS service_name,
         COALESCE(SUM(s.duration_minutes * aps.quantity), 0) AS duration_minutes,
         COALESCE(SUM(s.price * aps.quantity), 0) AS price,
         CONCAT('[',
           GROUP_CONCAT(
             JSON_OBJECT('id', s.id, 'name', s.name, 'duration_minutes', s.duration_minutes, 'price', s.price, 'quantity', aps.quantity)
             ORDER BY aps.position, s.id SEPARATOR ','
           ),
         ']') AS services
       FROM appointments a
       JOIN barbershops bs ON a.barbershop_id = bs.id
       JOIN customers c ON a.customer_id = c.id
       JOIN barbers b ON a.barber_id = b.id
       LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
       LEFT JOIN services s ON s.id = aps.service_id
       WHERE bs.slug = ?
         AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.phone, '(', ''), ')', ''), '-', ''), ' ', ''), '+', '') = ?
       GROUP BY a.id, a.appointment_date, a.appointment_time, a.status, a.created_at,
                c.name, b.name, b.image_url
       ORDER BY a.appointment_date DESC, a.appointment_time DESC`,
      [req.params.slug, digits],
    );

    res.json(rows.map(normalizeAppointmentRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/public/:slug', async (req, res) => {
  const {
    barber_id,
    appointment_date,
    appointment_time,
    customer_name,
    customer_phone,
    customer_email,
    privacy_policy_accepted,
    marketing_consent,
  } = req.body;

  const serviceItems = collectServiceItems(req.body);

  if (!barber_id || !serviceItems.length || !appointment_date || !appointment_time || !customer_name || !customer_phone) {
    return res.status(400).json({
      error: 'Campos obrigatorios: barber_id, service_items, appointment_date, appointment_time, customer_name, customer_phone',
    });
  }

  if (!privacy_policy_accepted) {
    return res.status(400).json({ error: 'Aceite a Politica de Privacidade para continuar.' });
  }

  try {
    await ensurePrivacySchema(db);
    await ensureAppointmentServicesSchema();

    const [shopRows] = await db.query(
      'SELECT id FROM barbershops WHERE slug = ? LIMIT 1',
      [req.params.slug],
    );
    if (!shopRows.length) {
      return res.status(404).json({ error: 'Barbearia nao encontrada' });
    }

    const barbershopId = shopRows[0].id;

    const [barberRows] = await db.query(
      'SELECT id FROM barbers WHERE id = ? AND barbershop_id = ? LIMIT 1',
      [barber_id, barbershopId],
    );
    if (!barberRows.length) {
      return res.status(400).json({ error: 'Barbeiro invalido para esta barbearia' });
    }

    const servicesValid = await validateServiceItems(serviceItems, barbershopId);
    if (!servicesValid) {
      return res.status(400).json({ error: 'Servico invalido para esta barbearia' });
    }

    let customerId;
    const [customerRows] = await db.query(
      'SELECT id FROM customers WHERE barbershop_id = ? AND phone = ? LIMIT 1',
      [barbershopId, customer_phone],
    );

    if (customerRows.length) {
      customerId = customerRows[0].id;
      await db.query(
        `UPDATE customers
         SET privacy_policy_accepted_at = NOW(), privacy_policy_version = ?,
          marketing_consent = ?, marketing_consent_at = ?
         WHERE id = ? AND barbershop_id = ?`,
        [
          PRIVACY_POLICY_VERSION,
          marketing_consent ? 1 : 0,
          marketing_consent ? new Date() : null,
          customerId,
          barbershopId,
        ],
      );
    } else {
      const [customerResult] = await db.query(
        `INSERT INTO customers
         (barbershop_id, name, phone, email, privacy_policy_accepted_at,
          privacy_policy_version, marketing_consent, marketing_consent_at)
         VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)`,
        [
          barbershopId,
          customer_name,
          customer_phone,
          customer_email || null,
          PRIVACY_POLICY_VERSION,
          marketing_consent ? 1 : 0,
          marketing_consent ? new Date() : null,
        ],
      );
      customerId = customerResult.insertId;
    }

    await recordConsentLog(db, req, {
      barbershopId,
      holderType: 'customer',
      holderId: customerId,
      action: 'privacy_policy_accepted',
      policyVersion: PRIVACY_POLICY_VERSION,
    });

    const [conflict] = await db.query(
      `SELECT id FROM appointments
       WHERE barbershop_id = ? AND barber_id = ? AND appointment_date = ? AND appointment_time = ? AND status != 'cancelled'`,
      [barbershopId, barber_id, appointment_date, appointment_time],
    );
    if (conflict.length) {
      return res.status(409).json({ error: 'Horario ja ocupado para este barbeiro' });
    }

    const [result] = await db.query(
      `INSERT INTO appointments
       (barbershop_id, barber_id, customer_id, service_id, appointment_date, appointment_time)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [barbershopId, barber_id, customerId, serviceItems[0].service_id, appointment_date, appointment_time],
    );

    await replaceAppointmentServices(result.insertId, serviceItems);

    res.status(201).json({ id: result.insertId, appointment_date, appointment_time, status: 'pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', authenticateToken, async (req, res) => {
  const { barber_id, date, status } = req.query;
  try {
    await ensureAppointmentServicesSchema();

    let query = `SELECT ${APPOINTMENT_SELECT} ${APPOINTMENT_JOINS} WHERE a.barbershop_id = ?`;
    const params = [req.barbershop.id];

    if (barber_id) { query += ' AND a.barber_id = ?'; params.push(barber_id); }
    if (date) { query += ' AND a.appointment_date = ?'; params.push(date); }
    if (status) { query += ' AND a.status = ?'; params.push(status); }

    query += ` ${APPOINTMENT_GROUP_BY} ORDER BY a.appointment_date, a.appointment_time`;

    const [rows] = await db.query(query, params);
    res.json(rows.map(normalizeAppointmentRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    await ensureAppointmentServicesSchema();
    const apt = await fetchAppointmentById(req.params.id, req.barbershop.id);
    if (!apt) return res.status(404).json({ error: 'Agendamento nao encontrado' });
    res.json(apt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  const { barber_id, customer_id, appointment_date, appointment_time } = req.body;
  const serviceItems = collectServiceItems(req.body);

  if (!barber_id || !customer_id || !serviceItems.length || !appointment_date || !appointment_time) {
    return res.status(400).json({
      error: 'Campos obrigatorios: barber_id, customer_id, service_items, appointment_date, appointment_time',
    });
  }

  try {
    await ensureAppointmentServicesSchema();

    const [[barberRows], [customerRows]] = await Promise.all([
      db.query('SELECT id FROM barbers WHERE id = ? AND barbershop_id = ? LIMIT 1', [barber_id, req.barbershop.id]),
      db.query('SELECT id FROM customers WHERE id = ? AND barbershop_id = ? LIMIT 1', [customer_id, req.barbershop.id]),
    ]);

    if (!barberRows.length || !customerRows.length) {
      return res.status(400).json({ error: 'Barbeiro ou cliente invalido para esta barbearia' });
    }

    const servicesValid = await validateServiceItems(serviceItems, req.barbershop.id);
    if (!servicesValid) {
      return res.status(400).json({ error: 'Servico invalido para esta barbearia' });
    }

    const [conflict] = await db.query(
      `SELECT id FROM appointments
       WHERE barbershop_id = ? AND barber_id = ? AND appointment_date = ? AND appointment_time = ? AND status != 'cancelled'`,
      [req.barbershop.id, barber_id, appointment_date, appointment_time],
    );
    if (conflict.length) {
      return res.status(409).json({ error: 'Horario ja ocupado para este barbeiro' });
    }

    const [result] = await db.query(
      `INSERT INTO appointments
       (barbershop_id, barber_id, customer_id, service_id, appointment_date, appointment_time)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.barbershop.id, barber_id, customer_id, serviceItems[0].service_id, appointment_date, appointment_time],
    );

    await replaceAppointmentServices(result.insertId, serviceItems);

    const created = await fetchAppointmentById(result.insertId, req.barbershop.id);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  const { barber_id, appointment_date, appointment_time } = req.body;

  try {
    await ensureAppointmentServicesSchema();

    const [currentRows] = await db.query(
      'SELECT * FROM appointments WHERE id = ? AND barbershop_id = ?',
      [req.params.id, req.barbershop.id],
    );
    if (!currentRows.length) {
      return res.status(404).json({ error: 'Agendamento nao encontrado' });
    }
    const current = currentRows[0];

    const next = {
      barber_id: barber_id ?? current.barber_id,
      appointment_date: appointment_date ?? current.appointment_date,
      appointment_time: appointment_time ?? current.appointment_time,
    };

    if (next.barber_id !== current.barber_id) {
      const [rows] = await db.query(
        'SELECT id FROM barbers WHERE id = ? AND barbershop_id = ? LIMIT 1',
        [next.barber_id, req.barbershop.id],
      );
      if (!rows.length) {
        return res.status(400).json({ error: 'Barbeiro invalido para esta barbearia' });
      }
    }

    const wantsServiceUpdate = Array.isArray(req.body.service_items)
      || Array.isArray(req.body.service_ids)
      || req.body.service_id != null;
    let nextServiceItems = null;
    if (wantsServiceUpdate) {
      nextServiceItems = collectServiceItems(req.body);
      if (!nextServiceItems.length) {
        return res.status(400).json({ error: 'Informe pelo menos um servico.' });
      }
      const servicesValid = await validateServiceItems(nextServiceItems, req.barbershop.id);
      if (!servicesValid) {
        return res.status(400).json({ error: 'Servico invalido para esta barbearia' });
      }
    }

    const slotChanged = (
      next.barber_id !== current.barber_id
      || String(next.appointment_date) !== String(current.appointment_date)
      || String(next.appointment_time) !== String(current.appointment_time)
    );

    if (slotChanged) {
      const [conflict] = await db.query(
        `SELECT id FROM appointments
         WHERE barbershop_id = ? AND barber_id = ? AND appointment_date = ?
           AND appointment_time = ? AND status != 'cancelled' AND id != ?`,
        [req.barbershop.id, next.barber_id, next.appointment_date, next.appointment_time, req.params.id],
      );
      if (conflict.length) {
        return res.status(409).json({ error: 'Horario ja ocupado para este barbeiro' });
      }
    }

    const principalServiceId = nextServiceItems ? nextServiceItems[0].service_id : current.service_id;

    await db.query(
      `UPDATE appointments
       SET barber_id = ?, service_id = ?, appointment_date = ?, appointment_time = ?
       WHERE id = ? AND barbershop_id = ?`,
      [
        next.barber_id,
        principalServiceId,
        next.appointment_date,
        next.appointment_time,
        req.params.id,
        req.barbershop.id,
      ],
    );

    if (nextServiceItems) {
      await replaceAppointmentServices(req.params.id, nextServiceItems);
    }

    const updated = await fetchAppointmentById(req.params.id, req.barbershop.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/status', authenticateToken, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status invalido. Use: ${validStatuses.join(', ')}` });
  }

  try {
    await ensureAppointmentServicesSchema();

    const [result] = await db.query(
      'UPDATE appointments SET status = ? WHERE id = ? AND barbershop_id = ?',
      [status, req.params.id, req.barbershop.id],
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Agendamento nao encontrado' });

    const updated = await fetchAppointmentById(req.params.id, req.barbershop.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const [result] = await db.query(
      'DELETE FROM appointments WHERE id = ? AND barbershop_id = ?',
      [req.params.id, req.barbershop.id],
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Agendamento nao encontrado' });
    res.json({ message: 'Agendamento removido com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
