// App entry point
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
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

// Serve built frontend (if present) so a single port can host frontend+api
try {
  const frontendDist = path.join(
    process.cwd(),
    "ORGANIZATION FRONTEND",
    "dist",
  );
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));

    // Fallback to index.html only for real browser navigations.
    // Avoid returning HTML for asset/API requests.
    app.use((req, res, next) => {
      if (req.method !== "GET") {
        next();
        return;
      }

      const requestPath = req.path || "";
      const hasFileExtension = path.extname(requestPath) !== "";
      if (hasFileExtension) {
        next();
        return;
      }

      const isApiRoute =
        requestPath.startsWith("/auth") ||
        requestPath.startsWith("/organization") ||
        requestPath.startsWith("/campaign") ||
        requestPath.startsWith("/webhook") ||
        requestPath.startsWith("/messages") ||
        requestPath.startsWith("/billing") ||
        requestPath.startsWith("/config");
      if (isApiRoute) {
        next();
        return;
      }

      const acceptHeader = req.headers.accept || "";
      if (!acceptHeader.includes("text/html")) {
        next();
        return;
      }

      res.sendFile(path.join(frontendDist, "index.html"));
    });
    console.log("Serving built frontend from:", frontendDist);
  }
} catch (e) {
  console.error("Error setting up static frontend serving", e);
}

// 5️⃣ Global error handler (ALWAYS LAST)
app.use(errorHandler);

export default app;
