import express from "express";
import {
  getOrganization,
  updateOrganization,
  getTeamMembers,
  inviteTeamMember,
  updateTeamMemberRole,
  removeTeamMember,
  addContactsToOrganization,
  getOrganizationStats,
  getActivityLog,
  createOrganization,
  connectWhatsAppBusiness,
  addSalesRep,
  getOrganizationContacts,
  updateOrganizationContact,
  deleteOrganizationContact,
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
// Embedded signup: start -> client sends short-lived user access token to list WABAs

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
 * Contacts for organization
 */
router.post(
  "/contacts",
  authorize("OWNER", "ADMIN", "SALES_REP"),
  addContactsToOrganization,
);
router.get(
  "/contacts",
  authorize("OWNER", "ADMIN", "SALES_REP"),
  getOrganizationContacts,
);
router.put(
  "/contacts/:contactId",
  authorize("OWNER", "ADMIN", "SALES_REP"),
  updateOrganizationContact,
);
router.delete(
  "/contacts/:contactId",
  authorize("OWNER", "ADMIN", "SALES_REP"),
  deleteOrganizationContact,
);

/**
 * WhatsApp Numbers endpoints
 */
router.use("/whatsapp-numbers", whatsappNumberRoutes);

/**
 * WhatsApp Templates endpoints
 */
router.use("/whatsapp-templates", whatsappTemplateRoutes);

//sales reps
router.post("/sales-reps", authorize("OWNER", "ADMIN"), addSalesRep);

export default router;
