class AppError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Recurso nao encontrado') {
    super(404, message);
  }
}

class ValidationError extends AppError {
  constructor(message) {
    super(400, message);
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(409, message);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Acesso nao autorizado') {
    super(403, message);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Nao autenticado') {
    super(401, message);
  }
}

module.exports = { AppError, NotFoundError, ValidationError, ConflictError, ForbiddenError, UnauthorizedError };
