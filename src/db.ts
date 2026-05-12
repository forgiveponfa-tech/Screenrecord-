import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  real,
} from "drizzle-orm/pg-core";

export const sessionsTable = pgTable("sessions", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const recordingsTable = pgTable("recordings", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  filename: text("filename").notNull(),
  durationSeconds: real("duration_seconds").notNull().default(0),
  sizeBytes: integer("size_bytes").notNull().default(0),
  dataBase64: text("data_base64"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Railway PostgreSQL always needs SSL in production
const isProduction = process.env.NODE_ENV === "production";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

export const db = drizzle(pool);

export async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS recordings (
      id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      duration_seconds REAL NOT NULL DEFAULT 0,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      data_base64 TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log("[DB] Tables ready");
}
