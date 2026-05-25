const request = require('supertest');
const app = require('./helpers/app');
const { getPool, cleanup } = require('./helpers/db');

const STAMP = Date.now();
const SLUG = `apt-test-${STAMP}`;
const EMAIL = `apt-${STAMP}@example.com`;
const PASSWORD = 'Senha123!';

let db;
let barbershopId;
let token;
let barberId;
let serviceId;
let customerId;
let appointmentId;

beforeAll(async () => {
  db = getPool();

  // Cria barbearia
  const shopRes = await request(app).post('/api/barbershops').send({
    name: `Apt Test ${STAMP}`, slug: SLUG, email: EMAIL, password: PASSWORD,
    privacy_policy_accepted: true, terms_accepted: true,
  });
  barbershopId = shopRes.body.id;

  // Login
  const loginRes = await request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });
  token = loginRes.body.token;

  // Cria barbeiro
  const barberRes = await request(app)
    .post('/api/barbers')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Barbeiro Teste', phone: '(11) 98888-0000' });
  barberId = barberRes.body.id;

  // Cria serviço
  const serviceRes = await request(app)
    .post('/api/services')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Corte Simples', duration_minutes: 30, price: 35 });
  serviceId = serviceRes.body.id;

  // Cria cliente
  const customerRes = await request(app)
    .post('/api/customers')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Cliente Teste', phone: '(11) 97777-0000' });
  customerId = customerRes.body.id;
});

afterAll(async () => {
  if (barbershopId) await cleanup(db, barbershopId);
  await db.end();
});

describe('POST /api/appointments', () => {
  it('cria agendamento com dados validos', async () => {
    const res = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        barber_id: barberId,
        customer_id: customerId,
        service_items: [{ service_id: serviceId, quantity: 1 }],
        appointment_date: '2099-12-01',
        appointment_time: '10:00',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    appointmentId = res.body.id;
  });

  it('detecta conflito de horario com 409', async () => {
    const res = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        barber_id: barberId,
        customer_id: customerId,
        service_items: [{ service_id: serviceId, quantity: 1 }],
        appointment_date: '2099-12-01',
        appointment_time: '10:00',
      });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/appointments', () => {
  it('lista agendamentos sem paginacao', async () => {
    const res = await request(app)
      .get('/api/appointments')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('lista agendamentos com paginacao', async () => {
    const res = await request(app)
      .get('/api/appointments?page=1&limit=10')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('page', 1);
    expect(res.body).toHaveProperty('limit', 10);
  });
});

describe('PATCH /api/appointments/:id/status', () => {
  it('cancela o agendamento', async () => {
    const res = await request(app)
      .patch(`/api/appointments/${appointmentId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });
});

describe('DELETE /api/appointments/:id', () => {
  it('remove o agendamento', async () => {
    const res = await request(app)
      .delete(`/api/appointments/${appointmentId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
