import express from "express";
import { authenticate, authorize } from "../middlewares/authMiddleware.js";
import {
  getBillingPlans,
  getBillingOverview,
  getPesapalHealth,
  listBillingPromotions,
  createBillingPromotion,
  validateBillingPromotion,
  createBillingCheckout,
  listBillingPayments,
  getBillingPayment,
  verifyBillingPayment,
  cancelSubscription,
  pesapalWebhook,
  pesapalCallback,
} from "../controllers/billingController.js";

const router = express.Router();

// Public endpoints called by PesaPal
router.get("/pesapal/callback", pesapalCallback);
router.post("/pesapal/webhook", pesapalWebhook);

// Authenticated organization billing endpoints
router.use(authenticate);
router.use(authorize("OWNER", "ADMIN"));

router.get("/plans", getBillingPlans);
router.get("/overview", getBillingOverview);
router.get("/pesapal/health", getPesapalHealth);
router.get("/promotions", listBillingPromotions);
router.post("/promotions", authorize("ADMIN"), createBillingPromotion);
router.post("/promotions/validate", validateBillingPromotion);
router.post("/checkout", createBillingCheckout);
router.get("/payments", listBillingPayments);
router.get("/payments/:paymentId", getBillingPayment);
router.post("/payments/:paymentId/verify", verifyBillingPayment);
router.post("/subscription/cancel", cancelSubscription);

export default router;
