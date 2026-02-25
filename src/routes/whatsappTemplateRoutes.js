import express from "express";
import {
  getWhatsAppTemplates,
  getWhatsAppTemplate,
  createWhatsAppTemplate,
  updateWhatsAppTemplate,
  pollWhatsAppTemplateStatus,
  toggleWhatsAppTemplateStatus,
  deleteWhatsAppTemplate,
} from "../controllers/whatsappTemplateController.js";
import { authenticate, authorize } from "../middlewares/authMiddleware.js";

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * WhatsApp Templates endpoints
 */

// Get all templates
router.get("/", getWhatsAppTemplates);

// Create new template
router.post("/", authorize("OWNER", "ADMIN"), createWhatsAppTemplate);

// Poll Meta approval statuses for all organization templates
router.post(
  "/poll-status",
  authorize("OWNER", "ADMIN"),
  pollWhatsAppTemplateStatus,
);

// Get specific template
router.get("/:templateId", getWhatsAppTemplate);

// Update template
router.put("/:templateId", authorize("OWNER", "ADMIN"), updateWhatsAppTemplate);

// Poll Meta approval status for a specific template
router.post(
  "/:templateId/poll-status",
  authorize("OWNER", "ADMIN"),
  pollWhatsAppTemplateStatus,
);

// Toggle template status
router.put(
  "/:templateId/toggle",
  authorize("OWNER", "ADMIN"),
  toggleWhatsAppTemplateStatus,
);

// Delete template
router.delete(
  "/:templateId",
  authorize("OWNER", "ADMIN"),
  deleteWhatsAppTemplate,
);

export default router;
