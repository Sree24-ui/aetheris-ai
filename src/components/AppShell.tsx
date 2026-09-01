"use client";

import Icon from "./Icon";

interface AppShellProps {
  active: "home" | "progress" | "other";
  onGoHome: () => void;
  onGoProgress: () => void;
  children: React.ReactNode;
}

export default function AppShell({ active, onGoHome, onGoProgress, children }: AppShellProps) {
  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      <div className="ambient-blob blob-1" />
      <div className="ambient-blob blob-2" />

      <nav className="hidden md:flex h-screen w-64 fixed left-0 top-0 rounded-r-xl backdrop-blur-xl bg-white/5 border-r border-white/10 shadow-2xl flex-col p-element-gap z-50">
        <button onClick={onGoHome} className="flex items-center gap-3 mb-8 text-left">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-container to-secondary-container flex items-center justify-center shrink-0">
            <Icon name="auto_awesome" className="text-on-primary text-[20px]" filled />
          </div>
          <div>
            <h1 className="font-display-lg-mobile text-[20px] leading-tight text-secondary-fixed-dim">Aetheris</h1>
            <p className="font-label-caps text-label-caps text-on-surface-variant">AI Mentor Online</p>
          </div>
        </button>

        <ul className="flex-1 space-y-2">
          <li>
            <button
              onClick={onGoHome}
              className={`w-full flex items-center gap-4 rounded-full p-3 font-body-md text-body-md transition-all ${
                active === "home"
                  ? "bg-primary-container/20 text-primary-fixed-dim"
                  : "text-on-surface-variant hover:bg-white/10 hover:text-tertiary-fixed-dim"
              }`}
            >
              <Icon name="home" filled={active === "home"} />
              Home
            </button>
          </li>
          <li>
            <button
              onClick={onGoProgress}
              className={`w-full flex items-center gap-4 rounded-full p-3 font-body-md text-body-md transition-all ${
                active === "progress"
                  ? "bg-primary-container/20 text-primary-fixed-dim"
                  : "text-on-surface-variant hover:bg-white/10 hover:text-tertiary-fixed-dim"
              }`}
            >
              <Icon name="analytics" filled={active === "progress"} />
              Progress
            </button>
          </li>
        </ul>

        <div className="mt-auto">
          <button
            onClick={onGoHome}
            className="btn-sheen w-full relative overflow-hidden bg-white/5 border border-primary/30 text-primary-fixed-dim rounded-full py-3 px-6 font-body-md text-body-md font-semibold transition-all hover:border-primary/60 hover:shadow-[0_0_20px_rgba(208,188,255,0.2)]"
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              <Icon name="play_arrow" />
              Start Session
            </span>
          </button>
        </div>
      </nav>

      <header className="md:hidden flex justify-between items-center bg-white/5 backdrop-blur-md border-b border-white/10 p-4 sticky top-0 z-50">
        <button onClick={onGoHome} className="font-display-lg-mobile text-[22px] text-primary-container tracking-tight">
          Aetheris AI
        </button>
        <div className="flex gap-2">
          <button
            onClick={onGoHome}
            className={`p-2 rounded-full ${active === "home" ? "text-primary-fixed-dim" : "text-on-surface-variant"}`}
          >
            <Icon name="home" filled={active === "home"} />
          </button>
          <button
            onClick={onGoProgress}
            className={`p-2 rounded-full ${active === "progress" ? "text-primary-fixed-dim" : "text-on-surface-variant"}`}
          >
            <Icon name="analytics" filled={active === "progress"} />
          </button>
        </div>
      </header>

      <main className="flex-1 md:ml-64 min-h-screen relative z-10 w-full">{children}</main>
    </div>
  );
}
