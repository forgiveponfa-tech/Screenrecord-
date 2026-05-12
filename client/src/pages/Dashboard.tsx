import { useState, useEffect } from "react";
import { Link } from "wouter";
import { apiFetch } from "../lib/session";
import { formatDate, formatDuration } from "../lib/utils";

interface Session {
  id: number;
  code: string;
  label: string;
  status: string;
  createdAt: string;
  recordingCount: number;
}

interface Stats {
  totalSessions: number;
  activeSessions: number;
  totalRecordings: number;
  totalRecordingSeconds: number;
  recentSessions: Session[];
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [s, all] = await Promise.all([
        apiFetch<Stats>("/api/stats/dashboard"),
        apiFetch<Session[]>("/api/sessions"),
      ]);
      setStats(s);
      setSessions(all);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this session and all its recordings?")) return;
    await apiFetch(`/api/sessions/${id}`, { method: "DELETE" }).catch(() => {});
    load();
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a]">
        <Link href="/"><a className="text-gray-500 hover:text-white text-sm transition-colors">← Back</a></Link>
        <span className="font-mono text-xs text-gray-600 uppercase tracking-widest">Command Center</span>
        <button onClick={load} className="text-gray-500 hover:text-white text-xs font-mono transition-colors">Refresh</button>
      </div>

      <div className="flex-1 px-4 py-6 max-w-4xl mx-auto w-full space-y-6">
        <h1 className="text-2xl font-bold">Recordings &amp; Sessions</h1>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-green-500/30 border-t-green-400 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Stats */}
            {stats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Sessions", value: stats.totalSessions },
                  { label: "Active Now", value: stats.activeSessions, green: true },
                  { label: "Recordings", value: stats.totalRecordings },
                  { label: "Recorded Time", value: formatDuration(stats.totalRecordingSeconds) },
                ].map((stat) => (
                  <div key={stat.label} className="bg-[#111] border border-[#1a1a1a] rounded-xl p-4">
                    <p className="text-xs font-mono text-gray-500 uppercase mb-1">{stat.label}</p>
                    <p className={`text-2xl font-bold font-mono ${stat.green ? "text-green-400" : "text-white"}`}>
                      {stat.value}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Sessions list */}
            {sessions.length === 0 ? (
              <div className="text-center py-16 border border-dashed border-[#222] rounded-2xl">
                <p className="text-gray-500 mb-2">No sessions yet</p>
                <Link href="/cast">
                  <a className="text-xs text-green-400 font-mono hover:underline">Start broadcasting →</a>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className="bg-[#111] border border-[#1a1a1a] rounded-xl p-4 flex items-center gap-4 hover:border-[#333] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-green-400 font-bold text-sm">{s.code}</span>
                        <span
                          className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                            s.status === "active"
                              ? "bg-green-500/10 text-green-400 border border-green-500/20"
                              : "bg-[#1a1a1a] text-gray-500 border border-[#222]"
                          }`}
                        >
                          {s.status.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-sm text-white truncate">{s.label}</p>
                      <p className="text-xs text-gray-600 font-mono mt-0.5">
                        {formatDate(s.createdAt)} · {s.recordingCount} recordings
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {s.status === "active" ? (
                        <Link href="/view">
                          <a className="px-3 py-1.5 bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg text-xs font-mono hover:bg-green-500/20 transition-colors">
                            WATCH
                          </a>
                        </Link>
                      ) : (
                        <Link href={`/session/${s.id}`}>
                          <a className="px-3 py-1.5 bg-[#1a1a1a] text-gray-300 border border-[#222] rounded-lg text-xs font-mono hover:border-[#333] transition-colors">
                            REPLAY
                          </a>
                        </Link>
                      )}
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="p-1.5 text-gray-600 hover:text-red-400 transition-colors rounded-lg hover:bg-red-950/30"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
