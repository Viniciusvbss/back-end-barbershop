const logger = require('../utils/logger');

// Intercepta respostas 4xx e loga para auditoria e debugging
function validationLogger(req, res, next) {
  const start = Date.now();
  const originalJson = res.json.bind(res);

  res.json = function (body) {
    const status = res.statusCode;
    const duration = Date.now() - start;
    const meta = {
      ip: req.ip,
      method: req.method,
      path: req.path,
      status,
      durationMs: duration,
    };

    if (status >= 400 && status < 500) {
      const message = body?.error || body?.message || JSON.stringify(body);
      if (status === 400) {
        logger.warn('Erro de validacao', { ...meta, validationError: message });
      } else if (status === 401) {
        logger.warn('Nao autorizado', meta);
      } else if (status === 409) {
        logger.warn('Conflito de dados', { ...meta, conflict: message });
      }
    } else if (status >= 500) {
      logger.error('Erro interno', { ...meta, body: body?.error });
    }

    return originalJson(body);
  };

  next();
}

module.exports = validationLogger;
