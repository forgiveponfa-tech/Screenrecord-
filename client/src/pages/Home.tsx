import { Link } from "wouter";
import { getSavedViewCode, getSavedCastSession } from "../lib/session";

export default function Home() {
  const savedViewCode = getSavedViewCode();
  const savedCast = getSavedCastSession();

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl space-y-10">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-green-500/10 border border-green-500/20 mb-2">
            <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-5xl font-bold tracking-tight">
            Screen<span className="text-green-400">Watch</span>
          </h1>
          <p className="text-gray-400 text-lg max-w-md mx-auto">
            Remote screen monitoring. Share, watch live, and replay recorded activity.
          </p>
        </div>

        {/* Cards */}
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Cast card */}
          <div className="bg-[#111] border border-[#222] rounded-2xl p-6 space-y-4 hover:border-green-500/30 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h2 className="font-semibold text-white">Share Screen</h2>
                <p className="text-xs text-gray-500">Broadcasting device</p>
              </div>
            </div>
            <p className="text-sm text-gray-400">
              Open this on the device you want to monitor. Tap once to allow screen sharing.
            </p>
            {savedCast && (
              <p className="text-xs text-green-400/70 font-mono">
                Last session: {savedCast.code}
              </p>
            )}
            <Link href="/cast">
              <a className="block w-full text-center py-3 px-4 bg-green-500 hover:bg-green-400 text-black font-bold rounded-xl transition-colors font-mono text-sm">
                OPEN /CAST
              </a>
            </Link>
          </div>

          {/* View card */}
          <div className="bg-[#111] border border-[#222] rounded-2xl p-6 space-y-4 hover:border-green-500/30 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
              <div>
                <h2 className="font-semibold text-white">Watch Live</h2>
                <p className="text-xs text-gray-500">Your monitoring device</p>
              </div>
            </div>
            <p className="text-sm text-gray-400">
              Open this on your phone to watch the live stream and replay recordings.
            </p>
            {savedViewCode && (
              <p className="text-xs text-green-400/70 font-mono">
                Saved code: {savedViewCode} — auto-connects
              </p>
            )}
            <Link href="/view">
              <a className="block w-full text-center py-3 px-4 bg-green-500 hover:bg-green-400 text-black font-bold rounded-xl transition-colors font-mono text-sm">
                OPEN /VIEW
              </a>
            </Link>
          </div>
        </div>

        {/* Dashboard link */}
        <div className="text-center">
          <Link href="/dashboard">
            <a className="text-sm text-gray-500 hover:text-green-400 transition-colors font-mono">
              View all recordings and sessions →
            </a>
          </Link>
        </div>

        {/* How it works */}
        <div className="bg-[#111] border border-[#1a1a1a] rounded-2xl p-6 space-y-4">
          <h3 className="font-mono text-xs text-gray-500 uppercase tracking-widest">How it works</h3>
          <ol className="space-y-3 text-sm text-gray-400">
            <li className="flex gap-3">
              <span className="text-green-400 font-mono font-bold shrink-0">01</span>
              <span>Open <span className="text-white font-mono">/cast</span> on the device you want to monitor. Tap "Start" and approve the screen share prompt.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-green-400 font-mono font-bold shrink-0">02</span>
              <span>A 6-character code appears. Open <span className="text-white font-mono">/view</span> on your phone, enter the code once.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-green-400 font-mono font-bold shrink-0">03</span>
              <span>From now on, just open <span className="text-white font-mono">/view</span> — it auto-connects. The screen is recorded every 10 seconds to the cloud.</span>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
