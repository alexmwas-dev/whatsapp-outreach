// Campaign routes
import express from "express";
import {
  sendCampaign,
  getCampaignStats,
  createContactAndAttachToCampaign,
  createCampaign,
  getAllCampaigns,
  getCampaignById,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
  resendCampaign,
  deleteCampaign,
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
router.post("/:campaignId/pause", pauseCampaign);
router.post("/:campaignId/resume", resumeCampaign);
router.post("/:campaignId/cancel", cancelCampaign);
router.post("/:campaignId/resend", resendCampaign);
router.delete("/:campaignId", deleteCampaign);
router.post("/:campaignId/contacts/create", createContactAndAttachToCampaign);
router.post("/", createCampaign);
router.get("/", getAllCampaigns);
// Get campaign statistics
router.get("/stats", getCampaignStats);
router.get("/:campaignId", getCampaignById);

export default router;
