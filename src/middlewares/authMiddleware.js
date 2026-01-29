import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import logger from "../utils/loogger.js";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

/**
 * Verify JWT token and attach user to request
 */
export const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        status: "error",
        message: "No token provided",
      });
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        organization: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "User not found",
      });
    }

    // Attach user and organization to request
    req.user = user;
    req.organization = user.organization;

    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      logger.warn("Token expired", {
        meta: { error: error.message },
      });
      return res.status(401).json({
        status: "error",
        message: "Token expired",
      });
    }

    if (error.name === "JsonWebTokenError") {
      logger.warn("Invalid token", {
        meta: { error: error.message },
      });
      return res.status(401).json({
        status: "error",
        message: "Invalid token",
      });
    }

    logger.error("Authentication error", {
      meta: { error: error.message },
    });

    res.status(500).json({
      status: "error",
      message: "Authentication failed",
    });
  }
};

/**
 * Verify user has specific role
 */
export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        status: "error",
        message: "Not authenticated",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn("Unauthorized access attempt", {
        meta: {
          userId: req.user.id,
          userRole: req.user.role,
          requiredRoles: allowedRoles,
        },
      });

      return res.status(403).json({
        status: "error",
        message: "Insufficient permissions",
      });
    }

    next();
  };
};

/**
 * Optional authentication - attach user if token is valid, but don't require it
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next();
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        organization: true,
      },
    });

    if (user) {
      req.user = user;
      req.organization = user.organization;
    }
  } catch (error) {
    // Silent fail - authentication is optional
  }

  next();
};
