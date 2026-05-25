const logger = require('../utils/logger');
const { AppError } = require('../errors/AppError');

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'Slug ou email ja cadastrado' });
  }

  logger.error('Unhandled error', { message: err.message, stack: err.stack, path: req.path });

  const message = process.env.NODE_ENV === 'production'
    ? 'Erro interno do servidor'
    : err.message;

  res.status(500).json({ error: message });
};

module.exports = errorHandler;
