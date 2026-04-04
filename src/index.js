const { loadEnv } = require('./config/env');
loadEnv();

const express = require('express');
const cors = require('cors');
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

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/barbershops', require('./routes/barbershops'));
app.use('/api/barbers', require('./routes/barbers'));
app.use('/api/services', require('./routes/services'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/business-hours', require('./routes/businessHours'));

app.get('/', (req, res) => {
  res.json({ message: 'Barbershop SaaS API', version: '1.0.0' });
});

const db = require('./config/db');
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  try {
    await db.query('SELECT 1');
    console.log('Database connected successfully');
  } catch (err) {
    console.error('Database connection failed:', err.message);
  }
});
