import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";

interface HostEntry {
  ws: WebSocket;
  viewers: Set<WebSocket>;
}

const hosts = new Map<string, HostEntry>();
const viewerToSession = new Map<WebSocket, string>();

export function setupSignaling(wss: WebSocketServer): void {
  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    console.log(`[WS] Connection opened from ${req.socket.remoteAddress}`);

    ws.on("message", (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const type = msg.type as string;
      const sessionCode = msg.sessionCode as string | undefined;

      if (type === "host" && sessionCode) {
        const existing = hosts.get(sessionCode);
        if (existing) {
          existing.ws = ws;
        } else {
          hosts.set(sessionCode, { ws, viewers: new Set() });
        }
        ws.send(JSON.stringify({ type: "host-registered", sessionCode }));
        console.log(`[WS] Host registered for session ${sessionCode}`);
      } else if (type === "join" && sessionCode) {
        const entry = hosts.get(sessionCode);
        if (!entry) {
          ws.send(JSON.stringify({ type: "error", message: "Host not connected yet" }));
          return;
        }
        entry.viewers.add(ws);
        viewerToSession.set(ws, sessionCode);
        entry.ws.send(JSON.stringify({ type: "viewer-joined" }));
        console.log(`[WS] Viewer joined session ${sessionCode}`);
      } else if (type === "offer") {
        const code = sessionCode;
        if (!code) return;
        const entry = hosts.get(code);
        if (!entry) return;
        entry.viewers.forEach((viewer) => {
          if (viewer.readyState === WebSocket.OPEN) {
            viewer.send(JSON.stringify({ type: "offer", sdp: msg.sdp }));
          }
        });
      } else if (type === "answer") {
        const code = viewerToSession.get(ws) ?? sessionCode;
        if (!code) return;
        const entry = hosts.get(code);
        if (!entry) return;
        if (entry.ws.readyState === WebSocket.OPEN) {
          entry.ws.send(JSON.stringify({ type: "answer", sdp: msg.sdp }));
        }
      } else if (type === "ice-candidate") {
        const code = viewerToSession.get(ws) ?? sessionCode;
        if (!code) return;
        const entry = hosts.get(code);
        if (!entry) return;
        if (ws === entry.ws) {
          entry.viewers.forEach((viewer) => {
            if (viewer.readyState === WebSocket.OPEN) {
              viewer.send(JSON.stringify({ type: "ice-candidate", candidate: msg.candidate }));
            }
          });
        } else {
          if (entry.ws.readyState === WebSocket.OPEN) {
            entry.ws.send(JSON.stringify({ type: "ice-candidate", candidate: msg.candidate }));
          }
        }
      }
    });

    ws.on("close", () => {
      const sessionCode = viewerToSession.get(ws);
      if (sessionCode) {
        const entry = hosts.get(sessionCode);
        if (entry) entry.viewers.delete(ws);
        viewerToSession.delete(ws);
        return;
      }

      for (const [code, entry] of hosts.entries()) {
        if (entry.ws === ws) {
          entry.viewers.forEach((viewer) => {
            if (viewer.readyState === WebSocket.OPEN) {
              viewer.send(JSON.stringify({ type: "host-disconnected" }));
            }
          });
          hosts.delete(code);
          console.log(`[WS] Host disconnected: ${code}`);
          break;
        }
      }
    });

    ws.on("error", (err) => {
      console.error("[WS] Socket error:", err.message);
    });
  });
}
