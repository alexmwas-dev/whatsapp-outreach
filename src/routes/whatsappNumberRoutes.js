import express from "express";
import {
  getWhatsAppNumbers,
  getWhatsAppNumber,
  addWhatsAppNumber,
  updateWhatsAppNumber,
  toggleWhatsAppNumberStatus,
  deleteWhatsAppNumber,
  getWhatsAppNumberStats,
  getPrimaryWhatsAppNumber,
} from "../controllers/whatsappNumberController.js";
import { authenticate, authorize } from "../middlewares/authMiddleware.js";

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * WhatsApp Numbers endpoints
 */

// Get all numbers
router.get("/", getWhatsAppNumbers);

// Get primary (first active) number
router.get("/primary", getPrimaryWhatsAppNumber);

// Add new number
router.post("/", authorize("OWNER", "ADMIN"), addWhatsAppNumber);

// Get specific number
router.get("/:numberId", getWhatsAppNumber);

// Get number statistics
router.get("/:numberId/stats", getWhatsAppNumberStats);

// Update number
router.put("/:numberId", authorize("OWNER", "ADMIN"), updateWhatsAppNumber);

// Toggle active status
router.put(
  "/:numberId/toggle",
  authorize("OWNER", "ADMIN"),
  toggleWhatsAppNumberStatus,
);

// Delete number
router.delete("/:numberId", authorize("OWNER", "ADMIN"), deleteWhatsAppNumber);

export default router;
