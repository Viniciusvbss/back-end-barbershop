process.env.TZ = 'UTC';

const { loadEnv } = require('./config/env');
loadEnv();

const express = require('express');
const cors = require('cors');
const { PUBLIC_UPLOAD_PREFIX } = require('./utils/uploads');
const logger = require('./utils/logger');
const validationLogger = require('./middleware/validationLogger');
const { authLimiter, generalLimiter, publicBookingLimiter } = require('./middleware/rateLimit');

const app = express();

const allowedOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';

const setCorsHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
};

app.use((req, res, next) => {
  setCorsHeaders(res);
  next();
});

app.options(/.*/, (req, res) => {
  setCorsHeaders(res);
  res.statusCode = 204;
  res.end();
});

app.use(express.json());
app.use(validationLogger);

// Rate limit geral em todas as rotas /api
app.use('/api', generalLimiter);

app.use(PUBLIC_UPLOAD_PREFIX, require('./routes/uploads'));

// Rate limit estrito nas rotas de autenticacao
app.use('/api/auth', authLimiter);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/barbershops', require('./routes/barbershops'));
app.use('/api/barbers', require('./routes/barbers'));
app.use('/api/services', require('./routes/services'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/appointments/public', publicBookingLimiter);
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/business-hours', require('./routes/businessHours'));
app.use('/api/privacy', require('./routes/privacy'));

app.get('/', (req, res) => {
  res.json({ message: 'Barbershop SaaS API', version: '1.0.0' });
});

const db = require('./config/db');
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  logger.info(`Server running on port ${PORT}`);
  const rateLimitActive =
    process.env.NODE_ENV === 'production' || process.env.RATE_LIMIT_ENABLED === 'true';
  logger.info(`Rate limiting: ${rateLimitActive ? 'ATIVO' : 'DESATIVADO (dev) — defina RATE_LIMIT_ENABLED=true para testar'}`);
  try {
    await db.query('SELECT 1');
    logger.info('Database connected successfully');
  } catch (err) {
    logger.error('Database connection failed', { message: err.message });
  }
});
