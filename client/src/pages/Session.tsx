import { useState, useEffect } from "react";
import { useRoute, Link } from "wouter";
import { apiFetch } from "../lib/session";
import { formatDate, formatDuration, formatBytes } from "../lib/utils";

interface Session {
  id: number;
  code: string;
  label: string;
  status: string;
  createdAt: string;
  endedAt: string | null;
  recordingCount: number;
}

interface Recording {
  id: number;
  filename: string;
  durationSeconds: number;
  sizeBytes: number;
  createdAt: string;
}

export default function Session() {
  const [, params] = useRoute("/session/:id");
  const sessionId = parseInt(params?.id ?? "0");

  const [session, setSession] = useState<Session | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [loadingPlay, setLoadingPlay] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    Promise.all([
      apiFetch<Session>(`/api/sessions/${sessionId}`),
      apiFetch<Recording[]>(`/api/sessions/${sessionId}/recordings`),
    ])
      .then(([s, recs]) => { setSession(s); setRecordings(recs); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sessionId]);

  const handlePlay = async (rec: Recording) => {
    setPlayingId(rec.id);
    setLoadingPlay(true);
    if (playingUrl) URL.revokeObjectURL(playingUrl);
    try {
      const res = await fetch(`/api/recordings/${rec.id}/data`);
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      setPlayingUrl(URL.createObjectURL(blob));
    } catch {
      setPlayingId(null);
    } finally {
      setLoadingPlay(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this recording?")) return;
    await apiFetch(`/api/recordings/${id}`, { method: "DELETE" }).catch(() => {});
    setRecordings((prev) => prev.filter((r) => r.id !== id));
    if (playingId === id) { setPlayingUrl(null); setPlayingId(null); }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-green-500/30 border-t-green-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center gap-4">
        <p className="text-gray-400">Session not found</p>
        <Link href="/dashboard"><a className="text-green-400 text-sm font-mono hover:underline">← Back to dashboard</a></Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a]">
        <Link href="/dashboard"><a className="text-gray-500 hover:text-white text-sm transition-colors">← Dashboard</a></Link>
        <span className="font-mono text-xs text-green-400">{session.code}</span>
        <span className="w-16 text-right text-xs text-gray-600 font-mono">{recordings.length} clips</span>
      </div>

      <div className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{session.label}</h1>
          <div className="flex gap-4 text-xs text-gray-500 font-mono mt-1">
            <span>Started: {formatDate(session.createdAt)}</span>
            {session.endedAt && <span>Ended: {formatDate(session.endedAt)}</span>}
          </div>
        </div>

        {/* Video player */}
        {playingUrl && (
          <div className="rounded-2xl overflow-hidden border border-green-500/20">
            <div className="bg-[#111] px-3 py-2 flex items-center justify-between border-b border-[#1a1a1a]">
              <span className="text-xs font-mono text-green-400">
                PLAYING CLIP {String((recordings.findIndex(r => r.id === playingId) + 1)).padStart(3, "0")}
              </span>
              <button onClick={() => { setPlayingUrl(null); setPlayingId(null); }} className="text-xs text-gray-500 hover:text-white font-mono">close</button>
            </div>
            <video src={playingUrl} controls autoPlay playsInline className="w-full bg-black" />
          </div>
        )}

        {/* Recordings */}
        {recordings.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-[#222] rounded-2xl text-gray-500 text-sm">
            No recordings saved for this session.
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-mono text-gray-500 uppercase tracking-widest">Recording Clips</p>
            {recordings.map((rec, i) => (
              <div
                key={rec.id}
                className={`flex items-center gap-3 bg-[#111] border rounded-xl px-4 py-3 transition-colors ${
                  playingId === rec.id ? "border-green-500/40 bg-green-500/5" : "border-[#1a1a1a] hover:border-[#333]"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-sm text-white">Clip {String(i + 1).padStart(3, "0")}</p>
                  <div className="flex gap-3 text-xs text-gray-500 font-mono mt-0.5">
                    <span>{formatDuration(rec.durationSeconds)}</span>
                    <span>·</span>
                    <span>{formatBytes(rec.sizeBytes)}</span>
                    <span>·</span>
                    <span>{formatDate(rec.createdAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePlay(rec)}
                    disabled={loadingPlay}
                    className={`p-2 rounded-lg transition-colors disabled:opacity-40 ${
                      playingId === rec.id ? "bg-green-500 text-black" : "bg-green-500/10 text-green-400 hover:bg-green-500/20"
                    }`}
                  >
                    {loadingPlay && playingId === rec.id ? (
                      <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                    ) : (
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                    )}
                  </button>
                  <button
                    onClick={() => handleDelete(rec.id)}
                    className="p-2 text-gray-600 hover:text-red-400 transition-colors rounded-lg hover:bg-red-950/30"
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
      </div>
    </div>
  );
}
