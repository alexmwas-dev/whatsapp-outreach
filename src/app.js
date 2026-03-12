// App entry point
import express from "express";
import cors from "cors";
import { errorHandler } from "./middlewares/errorHandler.js";
import { httpLogger } from "./middlewares/httpLogger.js";
import authRoutes from "./routes/authRoutes.js";
import organizationRoutes from "./routes/organizationRoutes.js";
import campaignRoutes from "./routes/campaignRoutes.js";
import webhookRoutes from "./routes/webhookRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import billingRoutes from "./routes/billingRoutes.js";

const app = express();

// 1️⃣ CORS configuration
app.use(
  cors({
    origin: [
      "http://localhost:8080",
      "http://localhost:8081",
      "https://b084-62-8-79-110.ngrok-free.app",
      "https://8c00-62-8-79-110.ngrok-free.app",
      "https://org.sales-connect.site",
      "https://whatsapp-outreach.onrender.com",
      "https://salesconnect-hub.onrender.com",
    ],
    credentials: true,
  }),
);

// 2️⃣ Body parsing
app.use(express.json());

// 3️⃣ HTTP request logging (BEFORE routes)
app.use(httpLogger);

// 4️⃣ Routes

app.use("/auth", authRoutes);
app.use("/organization", organizationRoutes);
app.use("/campaign", campaignRoutes);
app.use("/webhook", webhookRoutes);
app.use("/messages", messageRoutes);
app.use("/billing", billingRoutes);

// Public config endpoint (minimal)
app.get("/config", (req, res) => {
  res.json({
    fbAppId: process.env.FB_APP_ID || null,
    fbConfigId: process.env.FB_CONFIG_ID || null,
    fbSdkVersion: process.env.FB_SDK_VERSION || "v24.0",
    businessId: process.env.META_BUSINESS_ID || process.env.BUSINESS_ID || null,
  });
});

// 5️⃣ Global error handler (ALWAYS LAST)
app.use(errorHandler);

export default app;
