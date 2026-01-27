import logger from "../utils/loogger.js";

export const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;

  logger.error(err.message, {
    meta: {
      statusCode,
      path: req.originalUrl,
      method: req.method,
      stack: err.stack,
    },
  });

  res.status(statusCode).json({
    status: err.status || "error",
    message: err.isOperational ? err.message : "Internal server error",
  });
};
