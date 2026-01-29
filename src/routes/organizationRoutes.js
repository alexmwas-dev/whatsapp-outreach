import express from "express";
import {
  getOrganization,
  updateOrganization,
  getTeamMembers,
  inviteTeamMember,
  updateTeamMemberRole,
  removeTeamMember,
  getOrganizationStats,
  getActivityLog,
  createOrganization,
  connectWhatsAppBusiness,
} from "../controllers/organizationController.js";
import whatsappNumberRoutes from "./whatsappNumberRoutes.js";
import whatsappTemplateRoutes from "./whatsappTemplateRoutes.js";
import { authenticate, authorize } from "../middlewares/authMiddleware.js";

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * Organization endpoints
 */
router.post("/", createOrganization);
router.post(
  "/connect-whatsapp",
  authorize("OWNER", "ADMIN"),
  connectWhatsAppBusiness,
);
router.get("/", getOrganization);
router.put("/", authorize("OWNER", "ADMIN"), updateOrganization);
router.get("/stats", getOrganizationStats);
router.get("/activity", getActivityLog);

/**
 * Team member endpoints
 */
router.get("/team", getTeamMembers);
router.post("/team/invite", authorize("OWNER", "ADMIN"), inviteTeamMember);
router.put(
  "/team/:memberId/role",
  authorize("OWNER", "ADMIN"),
  updateTeamMemberRole,
);
router.delete("/team/:memberId", authorize("OWNER"), removeTeamMember);

/**
 * WhatsApp Numbers endpoints
 */
router.use("/whatsapp-numbers", whatsappNumberRoutes);

/**
 * WhatsApp Templates endpoints
 */
router.use("/whatsapp-templates", whatsappTemplateRoutes);

export default router;
