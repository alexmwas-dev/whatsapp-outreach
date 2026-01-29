// Campaign routes
import express from "express";
import {
  sendCampaign,
  getCampaignStats,
  createContactAndAttachToCampaign,
  createCampaign,
} from "../controllers/campaignController.js";
import { authenticate } from "../middlewares/authMiddleware.js";

const router = express.Router();

// All campaign routes require authentication
router.use(authenticate);

/**
 * Campaign endpoints
 */

// Send campaign to contacts
router.post("/send", sendCampaign);
router.post("/:campaignId/contacts/create", createContactAndAttachToCampaign);
router.post("/", createCampaign);
router.get("/", getAllCampaigns);
router.get("/:campaignId", getCampaignById);
// Get campaign statistics
router.get("/stats", getCampaignStats);

export default router;
