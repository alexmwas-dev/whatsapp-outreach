import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import logger from "../utils/loogger.js";
import { prisma } from "./prisma.js";

let io = null;

/**
 * Initialize Socket.io server
 * @param {http.Server} server - HTTP server instance
 */
export function initializeSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:5173",
      credentials: true,
    },
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        return next(new Error("Authentication token required"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        include: {
          salesRep: true,
        },
      });

      if (!user) {
        return next(new Error("User not found"));
      }

      // Attach user info to socket
      socket.userId = user.id;
      socket.userRole = user.role;
      socket.organizationId = user.organizationId;
      socket.salesRepId = user.salesRep?.id;

      next();
    } catch (error) {
      logger.error("Socket authentication failed", { error: error.message });
      next(new Error("Authentication failed"));
    }
  });

  // Connection handler
  io.on("connection", (socket) => {
    logger.info("Client connected", {
      socketId: socket.id,
      userId: socket.userId,
      salesRepId: socket.salesRepId,
    });

    // Join user-specific room
    socket.join(`user:${socket.userId}`);

    // Join organization room
    if (socket.organizationId) {
      socket.join(`org:${socket.organizationId}`);
    }

    // Join sales rep room if applicable
    if (socket.salesRepId) {
      socket.join(`salesRep:${socket.salesRepId}`);
    }

    // Handle joining contact conversation room
    socket.on("join:contact", (contactId) => {
      socket.join(`contact:${contactId}`);
      logger.debug("Client joined contact room", {
        socketId: socket.id,
        contactId,
      });
    });

    // Handle leaving contact conversation room
    socket.on("leave:contact", (contactId) => {
      socket.leave(`contact:${contactId}`);
      logger.debug("Client left contact room", {
        socketId: socket.id,
        contactId,
      });
    });

    // Handle disconnect
    socket.on("disconnect", () => {
      logger.info("Client disconnected", {
        socketId: socket.id,
        userId: socket.userId,
      });
    });
  });

  logger.info("Socket.io initialized");
  return io;
}

/**
 * Get Socket.io instance
 */
export function getIO() {
  if (!io) {
    throw new Error("Socket.io not initialized. Call initializeSocket first.");
  }
  return io;
}

/**
 * Emit new message to relevant clients
 * @param {Object} message - Message object from database
 */
export function emitNewMessage(message) {
  if (!io) return;

  const eventData = {
    id: message.id,
    contactId: message.contactId,
    salesRepId: message.salesRepId,
    direction: message.direction,
    message: message.message,
    createdAt: message.createdAt,
    readAt: message.readAt,
  };

  // Emit to contact room (anyone viewing this conversation)
  io.to(`contact:${message.contactId}`).emit("message:new", eventData);

  // Emit to sales rep if assigned
  if (message.salesRepId) {
    io.to(`salesRep:${message.salesRepId}`).emit("message:new", eventData);
  }

  logger.debug("Emitted new message event", {
    messageId: message.id,
    contactId: message.contactId,
  });
}

/**
 * Emit message read status update
 * @param {string} contactId - Contact ID
 * @param {number} count - Number of messages marked as read
 */
export function emitMessagesRead(contactId, count) {
  if (!io) return;

  io.to(`contact:${contactId}`).emit("messages:read", {
    contactId,
    count,
    readAt: new Date(),
  });

  logger.debug("Emitted messages read event", { contactId, count });
}

/**
 * Emit contact status update
 * @param {Object} contact - Updated contact object
 */
export function emitContactUpdate(contact) {
  if (!io) return;

  // Emit to organization
  io.to(`org:${contact.organizationId}`).emit("contact:updated", {
    id: contact.id,
    status: contact.status,
    consent: contact.consent,
    salesRepId: contact.salesRepId,
    updatedAt: contact.updatedAt,
  });

  logger.debug("Emitted contact update event", { contactId: contact.id });
}
