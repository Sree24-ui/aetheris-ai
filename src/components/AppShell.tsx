"use client";

import { useSession, signOut } from "next-auth/react";
import Icon from "./Icon";
import UserAvatar from "./UserAvatar";

interface AppShellProps {
  active: "home" | "progress" | "profile" | "other";
  onGoHome: () => void;
  onGoProgress: () => void;
  onGoProfile: () => void;
  children: React.ReactNode;
}

export default function AppShell({ active, onGoHome, onGoProgress, onGoProfile, children }: AppShellProps) {
  const { data: session } = useSession();
  const userLabel = session?.user?.name || session?.user?.email || "Signed in";

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
          <li>
            <button
              onClick={onGoProfile}
              className={`w-full flex items-center gap-4 rounded-full p-3 font-body-md text-body-md transition-all ${
                active === "profile"
                  ? "bg-primary-container/20 text-primary-fixed-dim"
                  : "text-on-surface-variant hover:bg-white/10 hover:text-tertiary-fixed-dim"
              }`}
            >
              <Icon name="person" filled={active === "profile"} />
              Profile
            </button>
          </li>
        </ul>

        <div className="mt-auto space-y-3">
          <button
            onClick={onGoHome}
            className="btn-sheen w-full relative overflow-hidden bg-white/5 border border-primary/30 text-primary-fixed-dim rounded-full py-3 px-6 font-body-md text-body-md font-semibold transition-all hover:border-primary/60 hover:shadow-[0_0_20px_rgba(208,188,255,0.2)]"
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              <Icon name="play_arrow" />
              Start Session
            </span>
          </button>

          <div className="flex items-center gap-2 rounded-full bg-white/5 border border-white/10 p-1.5 pr-2">
            <button onClick={onGoProfile} className="flex items-center gap-2 flex-1 min-w-0 text-left" title="View profile">
              <UserAvatar name={session?.user?.name} email={session?.user?.email} image={session?.user?.image} size={28} />
              <span className="flex-1 text-xs text-on-surface-variant truncate">{userLabel}</span>
            </button>
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              title="Sign out"
              className="p-1.5 rounded-full text-on-surface-variant hover:text-error hover:bg-error-container/20 transition-colors"
            >
              <Icon name="logout" className="text-[16px]" />
            </button>
          </div>
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
          <button onClick={onGoProfile} className="p-1 rounded-full" title="Profile">
            <UserAvatar name={session?.user?.name} email={session?.user?.email} image={session?.user?.image} size={28} />
          </button>
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            title="Sign out"
            className="p-2 rounded-full text-on-surface-variant"
          >
            <Icon name="logout" />
          </button>
        </div>
      </header>

      {/* No `w-full` here: with the fixed 256px sidebar's `md:ml-64`, a full
          100% width plus that margin overflowed the viewport by exactly the
          sidebar width (clipping content at tablet sizes). `flex-1` plus
          `min-w-0` sizes it to the remaining space instead. */}
      <main className="flex-1 min-w-0 md:ml-64 min-h-screen relative z-10">{children}</main>
    </div>
  );
}
