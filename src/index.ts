import express from "express";
import cors from "cors";
import path from "path";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { setupRoutes } from "./routes";
import { setupSignaling } from "./signaling";
import { runMigrations } from "./db";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

app.use(cors());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

// Serve built React app
const publicDir = path.join(__dirname, "../public");
app.use(express.static(publicDir));

// API + WebSocket routes
setupRoutes(app);
setupSignaling(wss);

// SPA fallback — all non-API routes serve index.html
app.get("/*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.sendFile(path.join(publicDir, "index.html"));
});

const port = parseInt(process.env.PORT || "3000", 10);

server.listen(port, async () => {
  try {
    await runMigrations();
  } catch (err) {
    console.error("Migration failed:", err);
  }
  console.log(`ScreenWatch running on port ${port}`);
});
