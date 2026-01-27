// utils/AppError.js
export class AppError extends Error {
  constructor(message, statusCode = 500, meta = {}) {
    super(message);

    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.isOperational = true;
    this.meta = meta;

    Error.captureStackTrace(this, this.constructor);
  }
}
