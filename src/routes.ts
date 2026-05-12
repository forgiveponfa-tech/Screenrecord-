import { Express, Request, Response } from "express";
import { eq, desc, count } from "drizzle-orm";
import { db, sessionsTable, recordingsTable } from "./db";

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function getSessionWithCount(id: number) {
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id));
  if (!session) return null;
  const [{ value }] = await db
    .select({ value: count() })
    .from(recordingsTable)
    .where(eq(recordingsTable.sessionId, id));
  return { ...session, recordingCount: Number(value) };
}

export function setupRoutes(app: Express) {
  // Health check
  app.get("/api/healthz", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  // --- Sessions ---
  app.get("/api/sessions", async (_req: Request, res: Response) => {
    const sessions = await db
      .select()
      .from(sessionsTable)
      .orderBy(desc(sessionsTable.createdAt));

    const result = await Promise.all(
      sessions.map(async (s) => {
        const [{ value }] = await db
          .select({ value: count() })
          .from(recordingsTable)
          .where(eq(recordingsTable.sessionId, s.id));
        return { ...s, recordingCount: Number(value) };
      })
    );
    res.json(result);
  });

  app.post("/api/sessions", async (req: Request, res: Response) => {
    const { label } = req.body;
    if (!label || typeof label !== "string") {
      res.status(400).json({ error: "label is required" });
      return;
    }

    let code = generateCode();
    for (let i = 0; i < 10; i++) {
      const existing = await db
        .select()
        .from(sessionsTable)
        .where(eq(sessionsTable.code, code));
      if (existing.length === 0) break;
      code = generateCode();
    }

    const [session] = await db
      .insert(sessionsTable)
      .values({ label, code, status: "active" })
      .returning();
    res.status(201).json({ ...session, recordingCount: 0 });
  });

  app.get("/api/sessions/by-code/:code", async (req: Request, res: Response) => {
    const { code } = req.params;
    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.code, code.toUpperCase()));
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const full = await getSessionWithCount(session.id);
    res.json(full);
  });

  app.get("/api/sessions/:id", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const full = await getSessionWithCount(id);
    if (!full) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(full);
  });

  app.post("/api/sessions/:id/end", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const [session] = await db
      .update(sessionsTable)
      .set({ status: "ended", endedAt: new Date() })
      .where(eq(sessionsTable.id, id))
      .returning();
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const full = await getSessionWithCount(id);
    res.json(full);
  });

  app.post("/api/sessions/:id/reactivate", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const [session] = await db
      .update(sessionsTable)
      .set({ status: "active", endedAt: null })
      .where(eq(sessionsTable.id, id))
      .returning();
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const full = await getSessionWithCount(id);
    res.json(full);
  });

  app.delete("/api/sessions/:id", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    await db.delete(recordingsTable).where(eq(recordingsTable.sessionId, id));
    const [session] = await db
      .delete(sessionsTable)
      .where(eq(sessionsTable.id, id))
      .returning();
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.sendStatus(204);
  });

  // --- Recordings ---
  app.get("/api/sessions/:id/recordings", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const recordings = await db
      .select({
        id: recordingsTable.id,
        sessionId: recordingsTable.sessionId,
        filename: recordingsTable.filename,
        durationSeconds: recordingsTable.durationSeconds,
        sizeBytes: recordingsTable.sizeBytes,
        createdAt: recordingsTable.createdAt,
      })
      .from(recordingsTable)
      .where(eq(recordingsTable.sessionId, id))
      .orderBy(recordingsTable.createdAt);
    res.json(recordings);
  });

  app.post("/api/sessions/:id/recordings/upload", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const { filename, durationSeconds, sizeBytes, dataBase64 } = req.body;

    if (!filename || !dataBase64) {
      res.status(400).json({ error: "filename and dataBase64 are required" });
      return;
    }

    const [recording] = await db
      .insert(recordingsTable)
      .values({
        sessionId: id,
        filename,
        durationSeconds: durationSeconds ?? 0,
        sizeBytes: sizeBytes ?? 0,
        dataBase64,
      })
      .returning();

    res.status(201).json({
      id: recording.id,
      sessionId: recording.sessionId,
      filename: recording.filename,
      durationSeconds: recording.durationSeconds,
      sizeBytes: recording.sizeBytes,
      createdAt: recording.createdAt,
    });
  });

  app.get("/api/recordings/:id/data", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const [recording] = await db
      .select()
      .from(recordingsTable)
      .where(eq(recordingsTable.id, id));

    if (!recording || !recording.dataBase64) {
      res.status(404).json({ error: "Recording not found" });
      return;
    }

    const buffer = Buffer.from(recording.dataBase64, "base64");
    res.setHeader("Content-Type", "video/webm");
    res.setHeader("Content-Disposition", `inline; filename="${recording.filename}"`);
    res.setHeader("Content-Length", buffer.length);
    res.end(buffer);
  });

  app.delete("/api/recordings/:id", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const [recording] = await db
      .delete(recordingsTable)
      .where(eq(recordingsTable.id, id))
      .returning();
    if (!recording) {
      res.status(404).json({ error: "Recording not found" });
      return;
    }
    res.sendStatus(204);
  });

  // --- Stats ---
  app.get("/api/stats/dashboard", async (_req: Request, res: Response) => {
    const sessions = await db.select().from(sessionsTable);
    const recordings = await db.select().from(recordingsTable);

    const recentSessionsRaw = await db
      .select()
      .from(sessionsTable)
      .orderBy(desc(sessionsTable.createdAt))
      .limit(5);

    const recentSessions = await Promise.all(
      recentSessionsRaw.map(async (s) => {
        const [{ value }] = await db
          .select({ value: count() })
          .from(recordingsTable)
          .where(eq(recordingsTable.sessionId, s.id));
        return { ...s, recordingCount: Number(value) };
      })
    );

    res.json({
      totalSessions: sessions.length,
      activeSessions: sessions.filter((s) => s.status === "active").length,
      totalRecordings: recordings.length,
      totalRecordingSeconds: recordings.reduce((sum, r) => sum + (r.durationSeconds ?? 0), 0),
      recentSessions,
    });
  });
}
