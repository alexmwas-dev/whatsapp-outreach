// App entry point
import express from "express";
import { errorHandler } from "./middlewares/errorHandler.js";
import { httpLogger } from "./middlewares/httpLogger.js";
import authRoutes from "./routes/authRoutes.js";
import organizationRoutes from "./routes/organizationRoutes.js";
import campaignRoutes from "./routes/campaignRoutes.js";
import webhookRoutes from "./routes/webhookRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";

const app = express();

// 1️⃣ Body parsing
app.use(express.json());

// 2️⃣ HTTP request logging (BEFORE routes)
app.use(httpLogger);

// 3️⃣ Routes
app.use("/auth", authRoutes);
app.use("/organization", organizationRoutes);
app.use("/campaign", campaignRoutes);
app.use("/webhook", webhookRoutes);
app.use("/messages", messageRoutes);

// 4️⃣ Global error handler (ALWAYS LAST)
app.use(errorHandler);

export default app;
