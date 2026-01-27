// App entry point
import express from "express";
import { errorHandler } from "./middlewares/errorHandler.js";
import campaignRoutes from "./routes/campaignRoutes.js";
import webhookRoutes from "./routes/webhookRoutes.js";
import { httpLogger } from "./middlewares/httpLogger.js";

const app = express();

// 1️⃣ Body parsing
app.use(express.json());

// 2️⃣ HTTP request logging (BEFORE routes)
app.use(httpLogger);

// 3️⃣ Routes
app.use("/campaign", campaignRoutes);
app.use("/webhook", webhookRoutes);

// 4️⃣ Global error handler (ALWAYS LAST)
app.use(errorHandler);

export default app;
