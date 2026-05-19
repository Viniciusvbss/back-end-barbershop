const jwt = require('jsonwebtoken');

function authenticateBarber(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: 'Token de autenticacao nao fornecido' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.barber_id) {
      return res.status(403).json({ error: 'Token invalido para barbeiro' });
    }
    req.barber = { id: decoded.barber_id, barbershop_id: decoded.barbershop_id, name: decoded.name };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado, faca login novamente' });
    }
    return res.status(403).json({ error: 'Token invalido' });
  }
}

module.exports = authenticateBarber;
