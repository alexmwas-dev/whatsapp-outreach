// Campaign routes placeholder
import express from "express";
import { sendCampaign } from "../controllers/campaignController.js";

const router = express.Router();
router.post("/send", sendCampaign);

export default router;
