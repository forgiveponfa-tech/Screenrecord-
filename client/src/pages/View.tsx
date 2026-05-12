import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "wouter";
import {
  getSavedViewCode,
  saveViewCode,
  clearViewCode,
  STUN_SERVERS,
  apiFetch,
} from "../lib/session";
import { formatDate, formatDuration, formatBytes } from "../lib/utils";

interface Session {
  id: number;
  code: string;
  label: string;
  status: string;
  createdAt: string;
  recordingCount: number;
}

interface Recording {
  id: number;
  filename: string;
  durationSeconds: number;
  sizeBytes: number;
  createdAt: string;
}

type ConnStatus = "idle" | "connecting" | "waiting" | "connected" | "error";

export default function View() {
  const savedCode = getSavedViewCode();
  const [inputCode, setInputCode] = useState("");
  const [activeCode, setActiveCode] = useState<string>(savedCode || "");
  const [session, setSession] = useState<Session | null>(null);
  const [connStatus, setConnStatus] = useState<ConnStatus>(savedCode ? "connecting" : "idle");
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [loadingPlay, setLoadingPlay] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const retryRef = useRef<number | null>(null);
  const destroyedRef = useRef(false);
  const activeCodeRef = useRef(activeCode);
  activeCodeRef.current = activeCode;

  const loadRecordings = useCallback(async (sessionId: number) => {
    try {
      const recs = await apiFetch<Recording[]>(`/api/sessions/${sessionId}/recordings`);
      setRecordings(recs);
    } catch {}
  }, []);

  const stopConn = useCallback(() => {
    if (retryRef.current) clearTimeout(retryRef.current);
    retryRef.current = null;
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const scheduleRetry = useCallback((delay = 5000) => {
    if (destroyedRef.current) return;
    retryRef.current = window.setTimeout(() => {
      if (!destroyedRef.current && activeCodeRef.current) {
        connect(activeCodeRef.current);
      }
    }, delay);
  }, []); // eslint-disable-line

  const connect = useCallback((code: string) => {
    if (destroyedRef.current || !code) return;
    stopConn();
    setConnStatus("connecting");

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    wsRef.current = ws;

    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    pcRef.current = pc;

    pc.ontrack = (event) => {
      if (videoRef.current && event.streams[0]) {
        videoRef.current.srcObject = event.streams[0];
        setConnStatus("connected");
      }
    };

    pc.onicecandidate = (e) => {
      if (e.candidate && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ice-candidate", sessionCode: code, candidate: e.candidate }));
      }
    };

    pc.onconnectionstatechange = () => {
      if (destroyedRef.current) return;
      const s = pc.connectionState;
      if (s === "failed" || s === "closed") {
        setConnStatus("waiting");
        scheduleRetry(4000);
      }
    };

    ws.onopen = () => {
      if (destroyedRef.current) return;
      ws.send(JSON.stringify({ type: "join", sessionCode: code }));
    };

    ws.onmessage = async (event) => {
      if (destroyedRef.current) return;
      const msg = JSON.parse(event.data as string);

      if (msg.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: "answer", sessionCode: code, sdp: answer }));
      } else if (msg.type === "ice-candidate" && msg.candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch {}
      } else if (msg.type === "host-disconnected") {
        if (videoRef.current) videoRef.current.srcObject = null;
        setConnStatus("waiting");
        scheduleRetry(5000);
      } else if (msg.type === "error") {
        // Host not connected yet — retry silently
        setConnStatus("waiting");
        scheduleRetry(5000);
      }
    };

    ws.onerror = () => { if (!destroyedRef.current) scheduleRetry(5000); };
    ws.onclose = () => {
      if (!destroyedRef.current && connStatus !== "connected") scheduleRetry(5000);
    };
  }, [stopConn, scheduleRetry, connStatus]);

  // Fetch session info whenever activeCode changes
  useEffect(() => {
    if (!activeCode) return;
    apiFetch<Session>(`/api/sessions/by-code/${activeCode}`)
      .then((s) => {
        setSession(s);
        if (s.id) loadRecordings(s.id);
      })
      .catch(() => setSession(null));

    const interval = setInterval(() => {
      apiFetch<Session>(`/api/sessions/by-code/${activeCode}`)
        .then((s) => {
          setSession(s);
          if (s.id) loadRecordings(s.id);
        })
        .catch(() => {});
    }, 15000);

    return () => clearInterval(interval);
  }, [activeCode, loadRecordings]);

  // Start connection on mount if code is known
  useEffect(() => {
    destroyedRef.current = false;
    if (activeCode) connect(activeCode);
    return () => {
      destroyedRef.current = true;
      stopConn();
    };
  }, []); // eslint-disable-line

  const handleJoin = () => {
    const code = inputCode.trim().toUpperCase();
    if (!code) return;
    saveViewCode(code);
    setActiveCode(code);
    setConnStatus("connecting");
    connect(code);
  };

  const handleForget = () => {
    clearViewCode();
    stopConn();
    setActiveCode("");
    setSession(null);
    setConnStatus("idle");
    setRecordings([]);
  };

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

  const statusInfo: Record<ConnStatus, { label: string; color: string }> = {
    idle: { label: "Not connected", color: "text-gray-500" },
    connecting: { label: "Connecting...", color: "text-yellow-400" },
    waiting: { label: "Waiting for broadcaster...", color: "text-yellow-400" },
    connected: { label: "Live", color: "text-green-400" },
    error: { label: "Error", color: "text-red-400" },
  };

  // No code yet — show entry form
  if (connStatus === "idle" || !activeCode) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-green-500/10 border border-green-500/20 mb-2">
              <svg className="w-7 h-7 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold">Watch Screen</h1>
            <p className="text-gray-400 text-sm">Enter the 6-character code from the broadcasting device. After this, it auto-connects every time.</p>
          </div>
          <div className="space-y-3">
            <input
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="ENTER CODE"
              maxLength={6}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              autoFocus
              className="w-full bg-[#111] border border-[#333] rounded-xl px-4 py-4 font-mono text-3xl text-center tracking-[0.3em] text-green-400 placeholder:text-gray-700 placeholder:tracking-normal focus:outline-none focus:border-green-500/50"
            />
            <button
              onClick={handleJoin}
              disabled={inputCode.trim().length < 4}
              className="w-full py-4 bg-green-500 hover:bg-green-400 disabled:opacity-40 disabled:cursor-not-allowed text-black font-bold rounded-xl transition-colors font-mono text-lg"
            >
              CONNECT
            </button>
          </div>
          <p className="text-center text-xs text-gray-600">
            After connecting once, your code is saved. Just open <span className="font-mono">/view</span> next time — no code needed.
          </p>
          <div className="text-center">
            <Link href="/"><a className="text-xs text-gray-600 hover:text-gray-400 transition-colors">← Back to home</a></Link>
          </div>
        </div>
      </div>
    );
  }

  const info = statusInfo[connStatus];

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a]">
        <Link href="/"><a className="text-gray-500 hover:text-white text-sm transition-colors">← Back</a></Link>
        <div className="flex items-center gap-2">
          {connStatus === "connected" && <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />}
          {(connStatus === "connecting" || connStatus === "waiting") && (
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
          )}
          <span className={`text-xs font-mono ${info.color}`}>{info.label}</span>
        </div>
        <Link href="/dashboard">
          <a className="text-gray-500 hover:text-white text-xs font-mono transition-colors">RECORDINGS</a>
        </Link>
      </div>

      <div className="flex-1 flex flex-col px-4 py-4 gap-4 max-w-2xl mx-auto w-full">
        {/* Live video */}
        <div className="w-full aspect-video bg-black rounded-2xl overflow-hidden border border-[#1a1a1a] relative">
          {connStatus !== "connected" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-600">
              {connStatus === "waiting" ? (
                <>
                  <div className="w-8 h-8 border-2 border-yellow-400/30 border-t-yellow-400 rounded-full animate-spin" />
                  <p className="font-mono text-xs text-yellow-400/70">Waiting for broadcaster</p>
                  <p className="text-xs text-gray-600">Will connect automatically when they start</p>
                </>
              ) : (
                <>
                  <div className="w-8 h-8 border-2 border-green-500/30 border-t-green-400 rounded-full animate-spin" />
                  <p className="font-mono text-xs text-gray-500">Connecting...</p>
                </>
              )}
            </div>
          )}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className={`w-full h-full object-contain ${connStatus !== "connected" ? "hidden" : ""}`}
          />
          {connStatus === "connected" && (
            <button
              onClick={() => videoRef.current?.requestFullscreen?.()}
              className="absolute top-3 right-3 p-2 rounded-lg bg-black/50 text-white hover:bg-black/70 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            </button>
          )}
        </div>

        {/* Session info */}
        {session && (
          <div className="flex items-center justify-between bg-[#111] border border-[#1a1a1a] rounded-xl px-4 py-3">
            <div>
              <p className="text-xs text-gray-500 font-mono">SESSION {activeCode}</p>
              <p className="text-sm text-white">{session.label}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 font-mono">{session.recordingCount} recordings</p>
              <button onClick={handleForget} className="text-xs text-gray-600 hover:text-red-400 transition-colors font-mono">forget code</button>
            </div>
          </div>
        )}

        {/* Video playback */}
        {playingUrl && (
          <div className="w-full rounded-2xl overflow-hidden border border-green-500/20">
            <div className="bg-[#111] px-3 py-2 flex items-center justify-between border-b border-[#1a1a1a]">
              <span className="text-xs font-mono text-green-400">PLAYBACK</span>
              <button onClick={() => { setPlayingUrl(null); setPlayingId(null); }} className="text-xs text-gray-500 hover:text-white">close</button>
            </div>
            <video src={playingUrl} controls autoPlay playsInline className="w-full bg-black" />
          </div>
        )}

        {/* Recordings list */}
        {recordings.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-mono text-gray-500 uppercase tracking-widest px-1">Saved Recordings</p>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {recordings.map((rec, i) => (
                <div
                  key={rec.id}
                  className={`flex items-center justify-between bg-[#111] border rounded-xl px-4 py-3 transition-colors ${
                    playingId === rec.id ? "border-green-500/40 bg-green-500/5" : "border-[#1a1a1a] hover:border-[#333]"
                  }`}
                >
                  <div>
                    <p className="text-sm font-mono text-white">Clip {String(i + 1).padStart(3, "0")}</p>
                    <div className="flex gap-3 text-xs text-gray-500 font-mono mt-0.5">
                      <span>{formatDuration(rec.durationSeconds)}</span>
                      <span>·</span>
                      <span>{formatBytes(rec.sizeBytes)}</span>
                      <span>·</span>
                      <span>{formatDate(rec.createdAt)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handlePlay(rec)}
                    disabled={loadingPlay}
                    className="p-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-400 transition-colors disabled:opacity-40"
                  >
                    {loadingPlay && playingId === rec.id ? (
                      <div className="w-4 h-4 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" />
                    ) : (
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Waiting info */}
        {connStatus === "waiting" && (
          <div className="bg-yellow-950/20 border border-yellow-900/30 rounded-xl p-4 text-xs text-yellow-400/80 space-y-1">
            <p className="font-mono font-bold">Auto-reconnect is on</p>
            <p>This page will automatically connect the moment the other device starts broadcasting. No action needed — just leave this page open.</p>
          </div>
        )}
      </div>
    </div>
  );
}
