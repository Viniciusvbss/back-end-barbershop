const jwt = require('jsonwebtoken');

function authenticateCustomer(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: 'Token de autenticação não fornecido' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'customer') {
      return res.status(403).json({ error: 'Token inválido para esta operação' });
    }
    req.customer = decoded; // { id, email, name, type }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado, faça login novamente' });
    }
    return res.status(403).json({ error: 'Token inválido' });
  }
}

module.exports = authenticateCustomer;
