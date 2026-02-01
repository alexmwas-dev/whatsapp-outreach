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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
