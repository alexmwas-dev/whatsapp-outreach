// Webhook routes placeholder
import express from "express";
import {
  verifyWebhook,
  receiveMessage,
} from "../controllers/webhookController.js";

const router = express.Router();

router.get("/", verifyWebhook);
router.post("/", receiveMessage);

export default router;
