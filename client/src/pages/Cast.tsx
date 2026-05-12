import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "wouter";
import {
  getSavedCastSession,
  saveCastSession,
  clearCastSession,
  STUN_SERVERS,
  apiFetch,
} from "../lib/session";
import { formatDuration } from "../lib/utils";

interface Session {
  id: number;
  code: string;
  label: string;
  status: string;
}

type Phase = "idle" | "starting" | "live" | "error";

export default function Cast() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [session, setSession] = useState<Session | null>(getSavedCastSession());
  const [elapsed, setElapsed] = useState(0);
  const [chunks, setChunks] = useState(0);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const sessionRef = useRef<Session | null>(session);
  sessionRef.current = session;

  const cleanup = useCallback((endSession = false) => {
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    if (videoRef.current) videoRef.current.srcObject = null;
    if (endSession && sessionRef.current?.id) {
      apiFetch(`/api/sessions/${sessionRef.current.id}/end`, { method: "POST" }).catch(() => {});
    }
  }, []);

  useEffect(() => () => cleanup(false), [cleanup]);

  const startBroadcast = async () => {
    setPhase("starting");
    setErrorMsg("");

    try {
      // Get screen capture
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 10, max: 15 }, cursor: "always" } as MediaTrackConstraints,
        audio: true,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Create or reactivate session
      let sess: Session;
      const saved = getSavedCastSession();
      if (saved) {
        try {
          sess = await apiFetch<Session>(`/api/sessions/${saved.id}/reactivate`, { method: "POST" });
        } catch {
          sess = await apiFetch<Session>("/api/sessions", {
            method: "POST",
            body: JSON.stringify({ label: "Screen Monitor" }),
          });
        }
      } else {
        sess = await apiFetch<Session>("/api/sessions", {
          method: "POST",
          body: JSON.stringify({ label: "Screen Monitor" }),
        });
      }

      setSession(sess);
      saveCastSession(sess);
      setPhase("live");
      setElapsed(0);
      setChunks(0);

      timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);

      // Recording in 10-second chunks
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;

      recorder.ondataavailable = async (e) => {
        if (e.data.size < 1000) return;
        const currentSession = sessionRef.current;
        if (!currentSession) return;
        const reader = new FileReader();
        reader.readAsDataURL(e.data);
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(",")[1];
          try {
            await apiFetch(`/api/sessions/${currentSession.id}/recordings/upload`, {
              method: "POST",
              body: JSON.stringify({
                filename: `chunk-${Date.now()}.webm`,
                durationSeconds: 10,
                sizeBytes: e.data.size,
                dataBase64: base64,
              }),
            });
            setChunks((c) => c + 1);
          } catch (err) {
            console.error("Upload failed:", err);
          }
        };
      };

      recorder.start(10_000);

      // WebSocket signaling
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "host", sessionCode: sess.code }));
      };

      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data as string);

        if (msg.type === "viewer-joined") {
          const viewerId = `viewer-${Date.now()}`;
          const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
          peersRef.current.set(viewerId, pc);

          stream.getTracks().forEach((track) => pc.addTrack(track, stream));

          pc.onicecandidate = (e) => {
            if (e.candidate && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "ice-candidate", sessionCode: sess.code, candidate: e.candidate }));
            }
          };

          pc.onconnectionstatechange = () => {
            if (pc.connectionState === "failed" || pc.connectionState === "closed") {
              peersRef.current.delete(viewerId);
              pc.close();
            }
          };

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          ws.send(JSON.stringify({ type: "offer", sessionCode: sess.code, sdp: offer }));
        } else if (msg.type === "answer") {
          const pc = peersRef.current.values().next().value as RTCPeerConnection | undefined;
          if (pc) await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        } else if (msg.type === "ice-candidate" && msg.candidate) {
          peersRef.current.forEach(async (pc) => {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } catch {}
          });
        }
      };

      ws.onerror = () => console.error("[Cast] WebSocket error");

      // Stop when user stops screen share from system UI
      stream.getVideoTracks()[0].onended = () => {
        handleStop(false);
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("denied") || msg.includes("Permission")) {
        setErrorMsg("Screen share permission was denied. Please allow access and try again.");
      } else if (msg.includes("cancel")) {
        setErrorMsg("Screen share was cancelled. Tap Start again to try.");
      } else {
        setErrorMsg("Could not start screen sharing. Please try again.");
      }
      setPhase("error");
      cleanup(false);
    }
  };

  const handleStop = (endPermanently: boolean) => {
    cleanup(endPermanently);
    if (endPermanently) {
      clearCastSession();
      setSession(null);
    }
    setPhase("idle");
    setElapsed(0);
    setChunks(0);
  };

  const copyCode = () => {
    if (session?.code) {
      navigator.clipboard.writeText(session.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a]">
        <Link href="/">
          <a className="text-gray-500 hover:text-white text-sm transition-colors">← Back</a>
        </Link>
        <span className="font-mono text-xs text-gray-600 uppercase tracking-widest">Cast Device</span>
        {phase === "live" && (
          <span className="flex items-center gap-1.5 text-xs font-mono text-green-400">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            LIVE
          </span>
        )}
        {phase !== "live" && <span className="w-16" />}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 space-y-6 max-w-lg mx-auto w-full">
        {/* Preview */}
        <div className="w-full aspect-video bg-black rounded-2xl overflow-hidden border border-[#1a1a1a] relative">
          {phase !== "live" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600 gap-3">
              <svg className="w-12 h-12 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span className="font-mono text-xs uppercase text-gray-600">
                {phase === "starting" ? "Starting..." : "Not broadcasting"}
              </span>
            </div>
          )}
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className={`w-full h-full object-contain ${phase !== "live" ? "hidden" : ""}`}
          />
        </div>

        {/* Session code (when live) */}
        {phase === "live" && session && (
          <div className="w-full bg-[#111] border border-[#222] rounded-2xl p-5 space-y-3">
            <p className="text-xs font-mono text-gray-500 uppercase tracking-widest text-center">Session Code — share with viewer</p>
            <button
              onClick={copyCode}
              className="w-full text-center font-mono text-4xl font-bold tracking-[0.3em] text-green-400 py-2 hover:bg-green-400/5 rounded-xl transition-colors"
            >
              {session.code}
            </button>
            <p className="text-center text-xs text-gray-600 font-mono">
              {copied ? "Copied to clipboard!" : "Tap to copy"}
            </p>
            <div className="flex items-center justify-between text-xs font-mono text-gray-500 pt-2 border-t border-[#1a1a1a]">
              <span>Uptime: <span className="text-white">{formatDuration(elapsed)}</span></span>
              <span>Recordings saved: <span className="text-green-400">{chunks}</span></span>
            </div>
          </div>
        )}

        {/* Error */}
        {phase === "error" && (
          <div className="w-full bg-red-950/30 border border-red-900/50 rounded-xl p-4 text-sm text-red-400">
            {errorMsg}
          </div>
        )}

        {/* Controls */}
        <div className="w-full space-y-3">
          {phase === "idle" || phase === "error" ? (
            <button
              onClick={startBroadcast}
              className="w-full py-4 bg-green-500 hover:bg-green-400 text-black font-bold rounded-xl transition-colors font-mono text-lg"
            >
              {session ? "RESUME BROADCASTING" : "START BROADCASTING"}
            </button>
          ) : phase === "starting" ? (
            <div className="w-full py-4 bg-[#1a1a1a] text-gray-400 font-mono text-center rounded-xl">
              Requesting screen permission...
            </div>
          ) : (
            <div className="space-y-3">
              <button
                onClick={() => handleStop(false)}
                className="w-full py-3 bg-[#222] hover:bg-[#2a2a2a] text-white font-mono rounded-xl transition-colors text-sm"
              >
                Pause (keep session active)
              </button>
              <button
                onClick={() => handleStop(true)}
                className="w-full py-3 bg-red-950/50 hover:bg-red-900/50 border border-red-900/50 text-red-400 font-mono rounded-xl transition-colors text-sm"
              >
                End Session Permanently
              </button>
            </div>
          )}
        </div>

        {/* Info */}
        {phase === "idle" && (
          <div className="w-full bg-[#111] border border-[#1a1a1a] rounded-xl p-4 space-y-2">
            <p className="text-xs font-mono text-gray-500 uppercase">What happens when you tap start:</p>
            <ol className="text-xs text-gray-400 space-y-1.5 list-none">
              <li className="flex gap-2"><span className="text-green-400">1.</span> Your browser asks permission to share the screen.</li>
              <li className="flex gap-2"><span className="text-green-400">2.</span> A 6-digit code appears — share it with the viewer once.</li>
              <li className="flex gap-2"><span className="text-green-400">3.</span> Your screen is recorded every 10 seconds and saved to the cloud.</li>
              <li className="flex gap-2"><span className="text-green-400">4.</span> Next time: tap Start again, same code — viewer auto-connects.</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
