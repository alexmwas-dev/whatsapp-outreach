import express from "express";
import {
  getAssignedContacts,
  getContactMessages,
  sendMessageToContact,
  getUnreadCount,
  markContactMessagesAsRead,
} from "../controllers/messageController.js";
import { authenticate, authorize } from "../middlewares/authMiddleware.js";

const router = express.Router();

/**
 * All routes require authentication
 * Most routes are for SALES_REP role
 */

// Get all contacts assigned to sales rep
router.get(
  "/contacts",
  authenticate,
  authorize("SALES_REP", "ADMIN", "OWNER"),
  getAssignedContacts,
);

// Get unread message count for sales rep
router.get(
  "/unread-count",
  authenticate,
  authorize("SALES_REP", "ADMIN", "OWNER"),
  getUnreadCount,
);

// Get all messages for a specific contact
router.get(
  "/contacts/:contactId/messages",
  authenticate,
  authorize("SALES_REP", "ADMIN", "OWNER"),
  getContactMessages,
);

// Send a message to a contact
router.post(
  "/contacts/:contactId/messages",
  authenticate,
  authorize("SALES_REP", "ADMIN", "OWNER"),
  sendMessageToContact,
);
router.post(
  "/contacts/:contactId/read",
  authenticate,
  authorize("SALES_REP", "ADMIN", "OWNER"),
  markContactMessagesAsRead,
);

export default router;
