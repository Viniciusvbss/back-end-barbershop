const request = require('supertest');
const app = require('./helpers/app');
const { getPool, cleanup } = require('./helpers/db');

const STAMP = Date.now();
const SLUG = `test-shop-${STAMP}`;
const EMAIL = `test-${STAMP}@example.com`;
const PASSWORD = 'Senha123!';

let db;
let barbershopId;
let token;

beforeAll(async () => {
  db = getPool();
});

afterAll(async () => {
  if (barbershopId) await cleanup(db, barbershopId);
  await db.end();
});

describe('POST /api/barbershops — criar barbearia', () => {
  it('cria barbearia com dados validos', async () => {
    const res = await request(app)
      .post('/api/barbershops')
      .send({
        name: `Barbearia Test ${STAMP}`,
        slug: SLUG,
        phone: '(11) 99999-0000',
        email: EMAIL,
        password: PASSWORD,
        privacy_policy_accepted: true,
        terms_accepted: true,
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    barbershopId = res.body.id;
  });

  it('rejeita slug duplicado com 409', async () => {
    const res = await request(app)
      .post('/api/barbershops')
      .send({
        name: 'Duplicado',
        slug: SLUG,
        email: `outro-${STAMP}@example.com`,
        password: PASSWORD,
        privacy_policy_accepted: true,
        terms_accepted: true,
      });
    expect(res.status).toBe(409);
  });

  it('rejeita campos obrigatorios ausentes com 400', async () => {
    const res = await request(app).post('/api/barbershops').send({ name: 'Sem slug' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  it('retorna token com credenciais corretas', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    token = res.body.token;
  });

  it('rejeita senha errada com 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: 'errada' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/barbershops — listagem autenticada', () => {
  it('retorna lista com token valido', async () => {
    const res = await request(app)
      .get(`/api/barbershops/${barbershopId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe(SLUG);
  });

  it('retorna 401 sem token', async () => {
    const res = await request(app).get(`/api/barbershops/${barbershopId}`);
    expect(res.status).toBe(401);
  });
});
