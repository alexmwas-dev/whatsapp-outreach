// server.js
import "dotenv/config";

// Basic diagnostics for startup issues
console.log("server.js: starting process");

process.on("uncaughtException", (err) => {
  console.error(
    "server.js: uncaughtException",
    err && err.stack ? err.stack : err,
  );
});

process.on("unhandledRejection", (reason) => {
  console.error("server.js: unhandledRejection", reason);
});

import app from "./app.js";
import { createServer } from "http";
import { initializeSocket } from "./lib/socket.js";
import { startCampaignWorker } from "./workers/campaignWorker.js";

const PORT = process.env.PORT || 3000;

// Create HTTP server
const httpServer = createServer(app);

// Initialize Socket.io
initializeSocket(httpServer);
startCampaignWorker();

httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));
