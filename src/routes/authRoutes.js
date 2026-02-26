import express from "express";
import {
  signup,
  login,
  googleAuth,
  logout,
  getCurrentUser,
  updateProfile,
  changePassword,
} from "../controllers/authController.js";
import { authenticate } from "../middlewares/authMiddleware.js";

const router = express.Router();

/**
 * Public routes
 */
router.post("/signup", signup);
router.post("/login", login);
router.post("/google", googleAuth);

/**
 * Protected routes (require authentication)
 */
router.get("/me", authenticate, getCurrentUser);
router.post("/logout", authenticate, logout);
router.put("/profile", authenticate, updateProfile);
router.post("/change-password", authenticate, changePassword);

export default router;
