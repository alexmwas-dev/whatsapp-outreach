// middlewares/httpLogger.js

import logger from "../utils/loogger.js";

export const httpLogger = (req, res, next) => {
  logger.http(`${req.method} ${req.originalUrl}`);
  next();
};
