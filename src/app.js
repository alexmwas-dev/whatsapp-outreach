// App entry point placeholder
import express from "express";
import campaignRoutes from "./routes/campaignRoutes.js";
import webhookRoutes from "./routes/webhookRoutes.js";

const app = express();
app.use(express.json());

app.use("/campaign", campaignRoutes);
app.use("/webhook", webhookRoutes);

export default app;
