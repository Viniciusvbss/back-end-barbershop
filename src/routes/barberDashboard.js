const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateBarber = require('../middleware/barberAuth');

// GET /api/barber/profile
router.get('/profile', authenticateBarber, async (req, res) => {
  try {
    const [[row]] = await db.query(
      `SELECT
        br.id, br.name, br.phone, br.image_url,
        b.id AS barbershop_id, b.name AS barbershop_name, b.logo_url AS barbershop_logo
       FROM barbers br
       INNER JOIN barbershops b ON b.id = br.barbershop_id
       WHERE br.id = ? AND br.barbershop_id = ?`,
      [req.barber.id, req.barber.barbershop_id],
    );
    if (!row) return res.status(404).json({ error: 'Barbeiro nao encontrado' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/barber/appointments?period=today|week
router.get('/appointments', authenticateBarber, async (req, res) => {
  try {
    const { period = 'today' } = req.query;

    let dateFilter;
    if (period === 'week') {
      dateFilter = 'YEARWEEK(a.appointment_date, 1) = YEARWEEK(CURDATE(), 1)';
    } else {
      dateFilter = 'DATE(a.appointment_date) = CURDATE()';
    }

    const [rows] = await db.query(
      `SELECT
        a.id,
        a.appointment_date,
        a.appointment_time,
        a.status,
        c.name AS customer_name,
        c.phone AS customer_phone,
        COALESCE(
          JSON_ARRAYAGG(
            JSON_OBJECT('name', s.name, 'price', s.price, 'quantity', aps.quantity)
          ),
          JSON_ARRAY()
        ) AS services,
        COALESCE(SUM(s.price * aps.quantity), 0) AS total_price
      FROM appointments a
      LEFT JOIN customers c ON c.id = a.customer_id
      LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
      LEFT JOIN services s ON s.id = aps.service_id
      WHERE a.barber_id = ?
        AND a.barbershop_id = ?
        AND ${dateFilter}
      GROUP BY a.id
      ORDER BY a.appointment_date ASC, a.appointment_time ASC`,
      [req.barber.id, req.barber.barbershop_id],
    );

    const appointments = rows.map((row) => ({
      ...row,
      services: typeof row.services === 'string' ? JSON.parse(row.services) : row.services,
      total_price: parseFloat(row.total_price),
    }));

    res.json(appointments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/barber/earnings
router.get('/earnings', authenticateBarber, async (req, res) => {
  try {
    const [[daily]] = await db.query(
      `SELECT COALESCE(SUM(s.price * aps.quantity), 0) AS total
       FROM appointments a
       LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
       LEFT JOIN services s ON s.id = aps.service_id
       WHERE a.barber_id = ?
         AND a.barbershop_id = ?
         AND a.status = 'completed'
         AND DATE(a.appointment_date) = CURDATE()`,
      [req.barber.id, req.barber.barbershop_id],
    );

    const [[weekly]] = await db.query(
      `SELECT COALESCE(SUM(s.price * aps.quantity), 0) AS total
       FROM appointments a
       LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
       LEFT JOIN services s ON s.id = aps.service_id
       WHERE a.barber_id = ?
         AND a.barbershop_id = ?
         AND a.status = 'completed'
         AND YEARWEEK(a.appointment_date, 1) = YEARWEEK(CURDATE(), 1)`,
      [req.barber.id, req.barber.barbershop_id],
    );

    const [[monthly]] = await db.query(
      `SELECT COALESCE(SUM(s.price * aps.quantity), 0) AS total
       FROM appointments a
       LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
       LEFT JOIN services s ON s.id = aps.service_id
       WHERE a.barber_id = ?
         AND a.barbershop_id = ?
         AND a.status = 'completed'
         AND MONTH(a.appointment_date) = MONTH(CURDATE())
         AND YEAR(a.appointment_date) = YEAR(CURDATE())`,
      [req.barber.id, req.barber.barbershop_id],
    );

    const [[lastMonth]] = await db.query(
      `SELECT COALESCE(SUM(s.price * aps.quantity), 0) AS total
       FROM appointments a
       LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
       LEFT JOIN services s ON s.id = aps.service_id
       WHERE a.barber_id = ?
         AND a.barbershop_id = ?
         AND a.status = 'completed'
         AND MONTH(a.appointment_date) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
         AND YEAR(a.appointment_date) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))`,
      [req.barber.id, req.barber.barbershop_id],
    );

    res.json({
      daily: parseFloat(daily.total),
      weekly: parseFloat(weekly.total),
      monthly: parseFloat(monthly.total),
      last_month: parseFloat(lastMonth.total),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/barber/history?year=2025&month=5
router.get('/history', authenticateBarber, async (req, res) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year) || now.getFullYear();
    const month = parseInt(req.query.month) || (now.getMonth() + 1);

    const dateFilter = `MONTH(a.appointment_date) = ? AND YEAR(a.appointment_date) = ?`;

    const [rows] = await db.query(
      `SELECT
        a.id,
        a.appointment_date,
        a.appointment_time,
        a.status,
        c.name AS customer_name,
        COALESCE(
          JSON_ARRAYAGG(
            JSON_OBJECT('name', s.name, 'price', s.price, 'quantity', aps.quantity)
          ),
          JSON_ARRAY()
        ) AS services,
        COALESCE(SUM(s.price * aps.quantity), 0) AS total_price
      FROM appointments a
      LEFT JOIN customers c ON c.id = a.customer_id
      LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
      LEFT JOIN services s ON s.id = aps.service_id
      WHERE a.barber_id = ?
        AND a.barbershop_id = ?
        AND a.status = 'completed'
        AND ${dateFilter}
      GROUP BY a.id
      ORDER BY a.appointment_date DESC, a.appointment_time DESC`,
      [req.barber.id, req.barber.barbershop_id, month, year],
    );

    const history = rows.map((row) => ({
      ...row,
      services: typeof row.services === 'string' ? JSON.parse(row.services) : row.services,
      total_price: parseFloat(row.total_price),
    }));

    const monthTotal = history.reduce((sum, r) => sum + r.total_price, 0);

    res.json({ items: history, total: monthTotal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
