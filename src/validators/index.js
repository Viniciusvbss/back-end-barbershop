const { ValidationError } = require('../errors/AppError');

const required = (...fields) => (req, res, next) => {
  const missing = fields.filter((f) => req.body[f] == null || req.body[f] === '');
  if (missing.length) {
    return next(new ValidationError(`Campos obrigatorios: ${missing.join(', ')}`));
  }
  next();
};

const paramId = (req, res, next) => {
  if (!Number.isInteger(Number(req.params.id)) || Number(req.params.id) <= 0) {
    return next(new ValidationError('ID invalido'));
  }
  next();
};

module.exports = { required, paramId };
