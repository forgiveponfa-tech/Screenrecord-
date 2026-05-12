import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "wouter";
import {
  getSavedCastSession,
  saveCastSession,
  clearCastSession,
  STUN_SERVERS,
  getSupportedMimeType,
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
      apiFetch(`/api/sessions/${sessionRef.current.id}/end`, {
        method: "POST",
      }).catch(() => {});
    }
  }, []);

  useEffect(() => () => cleanup(false), [cleanup]);

  const startBroadcast = async () => {
    setPhase("starting");
    setErrorMsg("");

    const ua = navigator.userAgent;

    // iOS: Apple blocks all screen capture APIs across every browser on iOS
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) &&
      !(window as unknown as Record<string, unknown>).MSStream;
    if (isIOS) {
      setErrorMsg(
        "iPhone and iPad cannot share their screen in any browser — this is a permanent Apple restriction. " +
          "Use Apple Screen Time instead: Settings → Screen Time → App Limits & Downtime."
      );
      setPhase("error");
      return;
    }

    // Must be HTTPS (Railway always uses HTTPS, so this only fires locally or on misconfigured setups)
    if (
      location.protocol !== "https:" &&
      location.hostname !== "localhost"
    ) {
      setErrorMsg(
        "Screen sharing requires HTTPS. Make sure you're opening the https:// version of your Railway URL."
      );
      setPhase("error");
      return;
    }

    // Check that the API exists in the browser at all
    if (
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getDisplayMedia !== "function"
    ) {
      setErrorMsg(
        "Your browser does not support screen sharing. " +
          "On Android, open this page in Chrome (version 94 or newer). " +
          "Samsung Internet and Firefox for Android do not support screen sharing."
      );
      setPhase("error");
      return;
    }

    try {
      // Request video only — no audio (silent screen cast)
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 10, max: 15 },
          // On Android Chrome, "display-capture" is ignored but doesn't cause failure
        },
        audio: false,
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
          sess = await apiFetch<Session>(
            `/api/sessions/${saved.id}/reactivate`,
            { method: "POST" }
          );
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

      timerRef.current = window.setInterval(
        () => setElapsed((e) => e + 1),
        1000
      );

      // --- Recording in 10-second chunks ---
      const mimeType = getSupportedMimeType();

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      } catch {
        // If the chosen mimeType is rejected, try without specifying one
        recorder = new MediaRecorder(stream);
      }
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

      // --- WebSocket signaling ---
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
              ws.send(
                JSON.stringify({
                  type: "ice-candidate",
                  sessionCode: sess.code,
                  candidate: e.candidate,
                })
              );
            }
          };

          pc.onconnectionstatechange = () => {
            if (
              pc.connectionState === "failed" ||
              pc.connectionState === "closed"
            ) {
              peersRef.current.delete(viewerId);
              pc.close();
            }
          };

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          ws.send(
            JSON.stringify({
              type: "offer",
              sessionCode: sess.code,
              sdp: offer,
            })
          );
        } else if (msg.type === "answer") {
          const pc = peersRef.current.values().next()
            .value as RTCPeerConnection | undefined;
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

      // Stop when user dismisses the screen share picker or ends sharing
      stream.getVideoTracks()[0].onended = () => {
        handleStop(false);
      };
    } catch (err: unknown) {
      const name = err instanceof DOMException ? err.name : "";
      const msg =
        err instanceof Error
          ? err.message.toLowerCase()
          : String(err).toLowerCase();

      if (
        name === "NotAllowedError" ||
        msg.includes("denied") ||
        msg.includes("permission")
      ) {
        setErrorMsg(
          "Screen share permission was denied. Tap Start again and approve the share prompt when it appears."
        );
      } else if (
        name === "AbortError" ||
        name === "NotReadableError" ||
        msg.includes("cancel") ||
        msg.includes("abort")
      ) {
        setErrorMsg(
          "Screen share was cancelled. Tap Start again and select a screen or tab to share."
        );
      } else if (name === "InvalidStateError") {
        setErrorMsg(
          "Please tap Start once and wait for the share prompt — do not tap multiple times."
        );
      } else if (
        name === "NotSupportedError" ||
        name === "TypeError" ||
        msg.includes("not a function") ||
        msg.includes("getdisplaymedia")
      ) {
        setErrorMsg(
          "Screen sharing is not supported on this browser. " +
            "On Android, use Chrome version 94 or newer. " +
            "Samsung Internet and Firefox for Android do not support this feature."
        );
      } else if (name === "OverconstrainedError") {
        setErrorMsg(
          "Screen sharing failed due to video settings. Tap Start to try again."
        );
      } else {
        setErrorMsg(
          `Screen sharing failed (${name || "unknown error"}). ` +
            "Make sure you are using Chrome on Android and the page URL starts with https://, then try again."
        );
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
          <a className="text-gray-500 hover:text-white text-sm transition-colors">
            ← Back
          </a>
        </Link>
        <span className="text-xs font-mono text-gray-500 uppercase tracking-widest">
          Broadcast
        </span>
        <Link href="/dashboard">
          <a className="text-xs font-mono text-gray-500 hover:text-white transition-colors">
            HISTORY
          </a>
        </Link>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 gap-6 max-w-md mx-auto w-full">
        {/* Preview */}
        <div className="w-full aspect-video bg-black rounded-2xl overflow-hidden border border-[#1a1a1a] relative">
          {phase !== "live" && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center space-y-2">
                <svg
                  className="w-10 h-10 text-gray-700 mx-auto"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
                <p className="text-xs text-gray-700 font-mono">
                  {phase === "starting" ? "Requesting permission..." : "No preview"}
                </p>
              </div>
            </div>
          )}
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className={`w-full h-full object-contain ${phase !== "live" ? "hidden" : ""}`}
          />
          {phase === "live" && (
            <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-red-500/90 text-white text-xs font-mono px-2 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              LIVE
            </div>
          )}
        </div>

        {/* Stats (live only) */}
        {phase === "live" && session && (
          <div className="w-full grid grid-cols-3 gap-3">
            <div className="bg-[#111] border border-[#1a1a1a] rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500 font-mono">TIME</p>
              <p className="text-sm font-mono text-white mt-0.5">
                {formatDuration(elapsed)}
              </p>
            </div>
            <div className="bg-[#111] border border-[#1a1a1a] rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500 font-mono">CLIPS SAVED</p>
              <p className="text-sm font-mono text-white mt-0.5">{chunks}</p>
            </div>
            <div
              className="bg-[#111] border border-[#1a1a1a] rounded-xl p-3 text-center cursor-pointer hover:border-[#333] transition-colors"
              onClick={copyCode}
            >
              <p className="text-xs text-gray-500 font-mono">CODE</p>
              <p className="text-sm font-mono text-green-400 mt-0.5">
                {copied ? "COPIED!" : session.code}
              </p>
            </div>
          </div>
        )}

        {/* Code display when idle but session saved */}
        {phase === "idle" && session && (
          <div className="w-full bg-[#111] border border-[#1a1a1a] rounded-2xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 font-mono">SAVED SESSION</p>
              <p className="text-lg font-mono text-green-400 tracking-widest mt-0.5">
                {session.code}
              </p>
            </div>
            <button
              onClick={copyCode}
              className="text-xs text-gray-500 hover:text-white font-mono transition-colors px-3 py-1.5 border border-[#333] rounded-lg"
            >
              {copied ? "COPIED" : "COPY"}
            </button>
          </div>
        )}

        {/* Error */}
        {phase === "error" && errorMsg && (
          <div className="w-full bg-red-500/10 border border-red-500/30 rounded-2xl p-4">
            <p className="text-sm text-red-400 leading-relaxed">{errorMsg}</p>
          </div>
        )}

        {/* Main action buttons */}
        <div className="w-full space-y-3">
          {phase !== "live" ? (
            <button
              onClick={startBroadcast}
              disabled={phase === "starting"}
              className="w-full py-4 bg-red-500 hover:bg-red-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-2xl transition-colors font-mono text-lg tracking-wide"
            >
              {phase === "starting" ? "REQUESTING..." : "▶ START BROADCASTING"}
            </button>
          ) : (
            <button
              onClick={() => handleStop(false)}
              className="w-full py-4 bg-[#111] hover:bg-[#1a1a1a] border border-red-500/40 text-red-400 font-bold rounded-2xl transition-colors font-mono text-lg"
            >
              ■ STOP (Resume Later)
            </button>
          )}

          {(phase === "idle" || phase === "error") && session && (
            <button
              onClick={() => {
                clearCastSession();
                setSession(null);
              }}
              className="w-full py-2 text-xs text-gray-600 hover:text-gray-400 font-mono transition-colors"
            >
              clear saved session
            </button>
          )}

          {phase === "live" && (
            <button
              onClick={() => handleStop(true)}
              className="w-full py-2 text-xs text-gray-600 hover:text-red-400 font-mono transition-colors"
            >
              END SESSION (deletes saved code)
            </button>
          )}
        </div>

        {/* Instructions */}
        {phase === "idle" && (
          <div className="w-full bg-[#0d0d0d] border border-[#1a1a1a] rounded-2xl p-4 space-y-2">
            <p className="text-xs text-gray-500 font-mono uppercase tracking-widest">
              How it works
            </p>
            <ol className="text-xs text-gray-500 space-y-1.5 list-decimal list-inside">
              <li>Tap Start Broadcasting and approve the screen share prompt</li>
              <li>Share the 6-character code with your viewer once</li>
              <li>
                Your screen streams live and is saved in 10-second clips every
                10 seconds
              </li>
              <li>
                The viewer can watch live or replay any saved clip later from
                /view
              </li>
            </ol>
            <p className="text-xs text-yellow-600 mt-2">
              Requires Chrome on Android. iPhone/iPad cannot share their screen
              in any browser.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
