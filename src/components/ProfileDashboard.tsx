"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Icon from "./Icon";
import UserAvatar from "./UserAvatar";
import { loadMemory } from "@/lib/memory";
import { apiRequest, errorMessage } from "@/lib/http";
import type { LearnerMemory } from "@/lib/types";

interface Profile {
  name: string | null;
  email: string;
  image: string | null;
  createdAt: string;
}

const EMPTY_MEMORY: LearnerMemory = { history: [], weakConcepts: [], strongConcepts: [] };

export default function ProfileDashboard({ onClose }: { onClose: () => void }) {
  const { update } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memory, setMemory] = useState<LearnerMemory>(EMPTY_MEMORY);
  const [loading, setLoading] = useState(true);
  const [nameDraft, setNameDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // H7: both loads report their own failure now. Previously a non-ok
    // /api/profile became `null` and a failed history load rejected into
    // nothing, leaving the page on its loading state forever.
    Promise.all([
      apiRequest<Profile>("/api/profile", { signal: controller.signal }),
      loadMemory(controller.signal),
    ])
      .then(([p, m]) => {
        setProfile(p);
        setNameDraft(p.name ?? "");
        setMemory(m);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(err));
        setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function saveName() {
    if (!nameDraft.trim() || !profile) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameDraft.trim() }),
      });
      if (!res.ok) throw new Error("Failed to update name");
      setProfile({ ...profile, name: nameDraft.trim() });
      await update({ name: nameDraft.trim() });
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const avgScore =
    memory.history.length > 0
      ? Math.round(
          memory.history.reduce((sum, h) => sum + (h.scorePercent ?? 0), 0) / memory.history.length
        )
      : 0;
  const conceptCount = new Set([...memory.weakConcepts, ...memory.strongConcepts]).size;

  if (loading) {
    return (
      <div className="w-full max-w-2xl mx-auto py-16 flex items-center justify-center gap-2 text-sm text-on-surface-variant">
        <span className="w-4 h-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        Loading your profile...
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="w-full max-w-2xl mx-auto py-16 text-center text-sm text-on-surface-variant">
        Couldn&apos;t load your profile.
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6 py-4">
      <button onClick={onClose} className="text-on-surface-variant hover:text-tertiary-fixed-dim text-sm flex items-center gap-1">
        <Icon name="arrow_back" className="text-[18px]" /> Back
      </button>

      <div className="glass-panel rounded-2xl p-6 flex items-center gap-5">
        <UserAvatar name={profile.name} email={profile.email} image={profile.image} size={64} />
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveName()}
                className="flex-1 bg-surface-container/60 border border-white/10 rounded-lg px-3 py-1.5 text-on-surface text-lg font-semibold focus:outline-none focus:border-primary/40"
              />
              <button
                onClick={saveName}
                disabled={saving}
                className="p-1.5 rounded-full bg-primary-container/30 text-primary-fixed-dim hover:bg-primary-container/50 disabled:opacity-50"
                title="Save"
              >
                <Icon name="check" className="text-[18px]" />
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setNameDraft(profile.name ?? "");
                }}
                className="p-1.5 rounded-full text-on-surface-variant hover:bg-white/5"
                title="Cancel"
              >
                <Icon name="close" className="text-[18px]" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h2 className="font-headline-md text-[22px] text-on-surface truncate">
                {profile.name || "Unnamed learner"}
              </h2>
              <button
                onClick={() => setEditing(true)}
                className="p-1 rounded-full text-on-surface-variant hover:text-primary-fixed-dim hover:bg-white/5"
                title="Edit name"
              >
                <Icon name="edit" className="text-[16px]" />
              </button>
            </div>
          )}
          <p className="text-sm text-on-surface-variant truncate">{profile.email}</p>
          <p className="text-xs text-outline mt-1">
            Member since {new Date(profile.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long" })}
          </p>
          {error && <p className="text-error text-xs mt-1">{error}</p>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="glass-panel rounded-xl p-5 text-center">
          <div className="font-display-lg text-[28px] text-primary-fixed-dim">{avgScore}%</div>
          <div className="font-label-caps text-label-caps text-outline text-[10px] mt-1">AVG SCORE</div>
        </div>
        <div className="glass-panel rounded-xl p-5 text-center">
          <div className="font-display-lg text-[28px] text-secondary-fixed-dim">{memory.history.length}</div>
          <div className="font-label-caps text-label-caps text-outline text-[10px] mt-1">SESSIONS</div>
        </div>
        <div className="glass-panel rounded-xl p-5 text-center">
          <div className="font-display-lg text-[28px] text-tertiary-fixed-dim">{conceptCount}</div>
          <div className="font-label-caps text-label-caps text-outline text-[10px] mt-1">CONCEPTS</div>
        </div>
      </div>

      {(memory.strongConcepts.length > 0 || memory.weakConcepts.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="glass-panel rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3 text-secondary-fixed">
              <Icon name="check_circle" className="text-xl" />
              <h4 className="font-label-caps text-label-caps">Strong Concepts</h4>
            </div>
            <div className="flex flex-wrap gap-2">
              {memory.strongConcepts.length > 0 ? (
                memory.strongConcepts.slice(0, 8).map((c) => (
                  <span key={c} className="px-3 py-1 bg-secondary/10 text-secondary-fixed-dim text-sm rounded-full border border-secondary/20">
                    {c}
                  </span>
                ))
              ) : (
                <span className="text-on-surface-variant text-sm">None yet</span>
              )}
            </div>
          </div>
          <div className="glass-panel rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3 text-tertiary-fixed-dim">
              <Icon name="flag" className="text-xl" />
              <h4 className="font-label-caps text-label-caps">Weak Concepts</h4>
            </div>
            <div className="flex flex-wrap gap-2">
              {memory.weakConcepts.length > 0 ? (
                memory.weakConcepts.slice(0, 8).map((c) => (
                  <span key={c} className="px-3 py-1 bg-tertiary/10 text-tertiary-fixed-dim text-sm rounded-full border border-tertiary/20">
                    {c}
                  </span>
                ))
              ) : (
                <span className="text-on-surface-variant text-sm">None yet</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
