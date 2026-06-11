import "dotenv/config";
import { startServer } from "./server.js";

// Start only when executed directly (not imported in tests)
const isMain =
  process.argv[1] != null &&
  new URL(import.meta.url).pathname === process.argv[1];

if (isMain) {
  startServer().catch((err: unknown) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}

export { buildServer, startServer } from "./server.js";
