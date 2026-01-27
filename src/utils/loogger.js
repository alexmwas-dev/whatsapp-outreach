import winston from "winston";
import path from "path";
import fs from "fs";

// Ensure logs directory exists
const logsDir = path.resolve("logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Colors for console
const colors = {
  error: "red",
  warn: "yellow",
  info: "green",
  http: "magenta",
  debug: "white",
};

winston.addColors(colors);

// Log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
  winston.format.errors({ stack: true }),
  winston.format.printf((info) => {
    const meta =
      info.meta && Object.keys(info.meta).length
        ? ` ${JSON.stringify(info.meta)}`
        : "";

    return `${info.timestamp} ${info.level}: ${info.message}${meta}`;
  }),
);

// Transports
const transports = [
  // Console
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize({ all: true }),
      logFormat,
    ),
  }),

  // Errors only
  new winston.transports.File({
    filename: path.join(logsDir, "error.log"),
    level: "error",
    format: winston.format.uncolorize(),
  }),

  // All logs
  new winston.transports.File({
    filename: path.join(logsDir, "combined.log"),
    format: winston.format.uncolorize(),
  }),

  // HTTP logs
  new winston.transports.File({
    filename: path.join(logsDir, "http.log"),
    level: "http",
    format: winston.format.uncolorize(),
  }),
];

// Create logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "debug",
  levels,
  transports,
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, "exceptions.log"),
    }),
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, "rejections.log"),
    }),
  ],
  exitOnError: false,
});

export default logger;
