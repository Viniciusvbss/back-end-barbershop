// Sobe o app Express sem chamar app.listen, para uso com supertest.
// Requer que DB_HOST, DB_USER, DB_PASSWORD, DB_NAME e JWT_SECRET estejam em .env.test
require('dotenv').config({ path: require('path').join(__dirname, '../../../.env.test') });
process.env.TZ = 'UTC';

const express = require('express');
const { PUBLIC_UPLOAD_PREFIX } = require('../../utils/uploads');
const errorHandler = require('../../middleware/errorHandler');

const app = express();

const allowedOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  next();
});

app.use(express.json());
app.use(PUBLIC_UPLOAD_PREFIX, require('../../routes/uploads'));
app.use('/api/auth', require('../../routes/auth'));
app.use('/api/barber/auth', require('../../routes/barberAuth'));
app.use('/api/barbershops', require('../../routes/barbershops'));
app.use('/api/barbers', require('../../routes/barbers'));
app.use('/api/services', require('../../routes/services'));
app.use('/api/customers', require('../../routes/customers'));
app.use('/api/appointments', require('../../routes/appointments'));
app.use('/api/business-hours', require('../../routes/businessHours'));
app.use('/api/privacy', require('../../routes/privacy'));
app.get('/', (req, res) => res.json({ message: 'ok' }));
app.use(errorHandler);

module.exports = app;
