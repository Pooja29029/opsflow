"use client";

/**
 * Rich per-task action card for the head's entity drawers (OrderQuickView /
 * AppointmentQuickView) — title + priority, an honest "Why?" panel built
 * from real fields (no fabricated VIP/risk signals), the checklist reframed
 * as "Required Actions" with a script viewer and an outcome-recording
 * wizard, and the existing next-step callout.
 *
 * OPS_HEAD is already authorized to PATCH any task (see canAccessTask in
 * /api/tasks/[id]) — this was previously a front-end-only "heads observe,
 * agents act" choice. Wiring writes here is a deliberate product change,
 * not a workaround: heads can now confirm/reschedule/snooze straight from
 * Smart View instead of only reassigning.
 */

import { useState } from "react";
import PriorityBadge from "@/components/shared/PriorityBadge";
import { formatISTTimestamp, titleToIST } from "@/lib/utils/timezone";
import type { ChecklistViewItem } from "@/components/shared/TaskChecklistView";

export interface ActionableTask {
  id: number;
  title: string;
  status: string;
  priority: string;
  slaDeadline: string;
  slaBreachedAt?: string | null;
  completedAt: string | null;
  createdAt: string;
  assignedTo: { id: number; name: string } | null;
  taskType: { label: string } | null;
  taskRule?: { name: string } | null;
  metadata?: Record<string, unknown> | null;
  checklistItems?: ChecklistViewItem[];
}

function relativeToNow(iso: string, now: Date): string {
  const diffMin = Math.round((new Date(iso).getTime() - now.getTime()) / 60_000);
  const abs = Math.abs(diffMin);
  const unit = abs < 60 ? `${abs}m` : abs < 60 * 24 ? `${Math.round(abs / 60)}h` : `${Math.round(abs / (60 * 24))}d`;
  return diffMin >= 0 ? `in ${unit}` : `${unit} ago`;
}

// Strip the rule-family prefix / trailing qualifier so "HSC: Confirm Booking
// (new order)" reads as "Confirm Booking" — matches the compact style used
// elsewhere (Smart View's Rule filter chips).
function cleanRuleName(raw: string): string {
  return raw.replace(/^[^:]*:\s*/, "").replace(/\s*\(.*$/, "").trim() || raw;
}

async function patchTask(taskId: number, body: Record<string, unknown>) {
  const res = await fetch(`/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `Failed to update task (HTTP ${res.status})`;
    try { const d = await res.json(); if (d?.error) msg = d.error; } catch { /* non-JSON body */ }
    throw new Error(msg);
  }
  return res.json();
}

export default function TaskActionCard({ task, onChanged }: { task: ActionableTask; onChanged: () => void }) {
  const [whyOpen, setWhyOpen] = useState(false);
  const [scriptItem, setScriptItem] = useState<ChecklistViewItem | null>(null);
  const [actionItem, setActionItem] = useState<ChecklistViewItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = task.checklistItems ?? [];
  const requiredDone = items.every((i) => !i.isRequired || i.isDone);
  const ns = (task.metadata?.nextStep ?? null) as { complete?: string | null; incomplete?: string | null } | null;
  const nextStep = ns ? (requiredDone ? ns.complete : ns.incomplete) : null;
  const now = new Date();

  const reasons: string[] = [];
  if (task.slaBreachedAt) reasons.push(`SLA breached ${relativeToNow(task.slaBreachedAt, now)}`);
  else reasons.push(`SLA due ${relativeToNow(task.slaDeadline, now)}`);
  reasons.push(`Priority: ${task.priority.charAt(0) + task.priority.slice(1).toLowerCase()}`);
  if (task.taskRule?.name) reasons.push(`Created by rule "${cleanRuleName(task.taskRule.name)}"`);

  async function toggleDone(item: ChecklistViewItem, isDone: boolean) {
    setBusy(true);
    setError(null);
    try {
      await patchTask(task.id, { checklistItemId: item.id, isDone });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setBusy(false);
    }
  }

  async function recordOutcome(item: ChecklistViewItem, outcome: "confirmed" | "reschedule" | "unreachable") {
    setBusy(true);
    setError(null);
    try {
      if (outcome === "confirmed") {
        await patchTask(task.id, { checklistItemId: item.id, isDone: true });
      } else {
        // No outcome field exists on Task yet — the closest real actions
        // the API supports are a snooze (task disappears from the active
        // queue until it re-surfaces) with a duration matched to how soon
        // a retry makes sense.
        await patchTask(task.id, { snoozeMinutes: outcome === "reschedule" ? 60 : 30 });
      }
      setActionItem(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save outcome");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-4 py-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-100 leading-snug">{titleToIST(task.title)}</div>
          <div className="text-[10px] text-zinc-600 mt-0.5">#{task.id} · {task.taskType?.label ?? "Task"}</div>
        </div>
        <PriorityBadge priority={task.priority as never} />
      </div>

      {/* Why? — real signals only (SLA timing, priority, originating rule).
          No fabricated VIP/risk tags — those fields don't exist in the data
          model yet. */}
      <div>
        <button
          onClick={() => setWhyOpen((o) => !o)}
          className="text-[11px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1"
        >
          Why? <svg className={`w-3 h-3 transition-transform ${whyOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </button>
        {whyOpen && (
          <ul className="mt-1.5 space-y-1 text-[11px] text-zinc-400 list-disc list-inside">
            {reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-500">
        <div><span className="text-zinc-600">Due:</span> {formatISTTimestamp(task.slaDeadline, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
        <div><span className="text-zinc-600">Created:</span> {formatISTTimestamp(task.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
      </div>

      {error && <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded px-2 py-1.5">{error}</div>}

      {items.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Required Actions</div>
          {items.map((item) => (
            <div key={item.id} className="flex items-start gap-2.5 bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2.5">
              <button
                onClick={() => toggleDone(item, !item.isDone)}
                disabled={busy}
                title={item.isDone ? "Mark as not done" : "Mark done"}
                className={`mt-0.5 shrink-0 hover:scale-110 transition-transform disabled:opacity-50 ${item.isDone ? "text-emerald-500" : "text-zinc-600 hover:text-zinc-400"}`}
              >
                {item.isDone ? "✓" : "○"}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-xs font-medium ${item.isDone ? "text-zinc-500 line-through" : "text-zinc-200"}`}>{item.stepText}</span>
                  {item.isRequired && !item.isDone && (
                    <span className="text-[9px] font-semibold uppercase tracking-wider text-red-400 bg-red-500/10 border border-red-500/30 rounded px-1 py-0.5">Required</span>
                  )}
                </div>
                {item.guidance && !item.isDone && (
                  <p className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">{item.guidance}</p>
                )}
                <div className="text-[10px] mt-1 text-zinc-600">
                  {item.isDone ? "Done" : "Pending"}
                </div>
              </div>
              {!item.isDone && (
                item.script ? (
                  <button
                    onClick={() => setScriptItem(item)}
                    className="shrink-0 px-2.5 py-1 rounded text-[11px] font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors flex items-center gap-1"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 8l-4 4 4 4" /></svg>
                    View Script
                  </button>
                ) : (
                  <button
                    onClick={() => setActionItem(item)}
                    className="shrink-0 px-2.5 py-1 rounded text-[11px] font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors"
                  >
                    Open action ›
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      )}

      {nextStep && (
        <div className={`rounded-lg border px-3 py-2.5 flex items-start gap-2 ${requiredDone ? "border-emerald-700/40 bg-emerald-500/5" : "border-amber-700/40 bg-amber-500/5"}`}>
          <span className="text-base leading-none mt-0.5">⚡</span>
          <div>
            <div className={`text-[10px] uppercase tracking-wider mb-0.5 ${requiredDone ? "text-emerald-400" : "text-amber-400"}`}>
              Next step {requiredDone ? "· checklist complete" : ""}
            </div>
            <div className="text-[11px] text-zinc-200 leading-relaxed whitespace-pre-wrap">{nextStep}</div>
          </div>
        </div>
      )}

      {scriptItem && (
        <ViewScriptModal item={scriptItem} onClose={() => setScriptItem(null)} />
      )}
      {actionItem && (
        <WhatToDoModal
          items={items}
          activeItem={actionItem}
          busy={busy}
          onOutcome={(outcome) => recordOutcome(actionItem, outcome)}
          onClose={() => setActionItem(null)}
        />
      )}
    </div>
  );
}

function ViewScriptModal({ item, onClose }: { item: ChecklistViewItem; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4" onClick={onClose}>
      <div className="fixed inset-0 bg-black/60" aria-hidden />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 8l-4 4 4 4" /></svg>
            View Script
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-5 py-4">
          <p className="text-xs text-zinc-500 mb-2">{item.stepText}</p>
          <div className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap bg-zinc-800/70 border border-zinc-700 rounded-lg px-4 py-3">
            {item.script}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-zinc-800">
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(item.script ?? "");
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch { /* clipboard unavailable — silently ignore */ }
            }}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-zinc-800 border border-zinc-700 text-zinc-200 hover:bg-zinc-700 transition-colors"
          >
            {copied ? "Copied ✓" : "Copy Script"}
          </button>
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function WhatToDoModal({
  items,
  activeItem,
  busy,
  onOutcome,
  onClose,
}: {
  items: ChecklistViewItem[];
  activeItem: ChecklistViewItem;
  busy: boolean;
  onOutcome: (outcome: "confirmed" | "reschedule" | "unreachable") => void;
  onClose: () => void;
}) {
  const [outcome, setOutcome] = useState<"confirmed" | "reschedule" | "unreachable" | null>(null);
  const steps = items.filter((i) => !i.isDone);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4" onClick={onClose}>
      <div className="fixed inset-0 bg-black/60" aria-hidden />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="text-sm font-semibold text-white">What to do</div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-[50vh] overflow-y-auto">
          {steps.map((s, i) => (
            <div key={s.id} className={`flex items-start gap-2.5 ${s.id === activeItem.id ? "" : "opacity-50"}`}>
              <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
              <div>
                <div className="text-sm text-zinc-100 font-medium">{s.stepText}</div>
                {s.guidance && <div className="text-xs text-zinc-500 mt-0.5">{s.guidance}</div>}
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 pb-2">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Select outcome</div>
          <div className="flex items-center gap-2 flex-wrap">
            {([
              { key: "confirmed" as const, label: "Confirmed", cls: "border-emerald-700 text-emerald-300 hover:bg-emerald-900/30" },
              { key: "reschedule" as const, label: "Reschedule needed", cls: "border-zinc-700 text-zinc-300 hover:bg-zinc-800" },
              { key: "unreachable" as const, label: "Could not reach", cls: "border-red-800 text-red-300 hover:bg-red-900/30" },
            ]).map((o) => (
              <button
                key={o.key}
                onClick={() => setOutcome(o.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  outcome === o.key ? "bg-zinc-700 border-zinc-500 text-white" : `bg-transparent ${o.cls}`
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="px-5 py-4">
          <button
            onClick={() => outcome && onOutcome(outcome)}
            disabled={!outcome || busy}
            className="w-full px-3 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
          >
            {busy ? "Saving…" : "Save outcome"}
          </button>
          <p className="text-[10px] text-zinc-600 mt-2 leading-relaxed">
            {outcome === "confirmed" && "Marks this step done."}
            {outcome === "reschedule" && "Snoozes this task for 1 hour."}
            {outcome === "unreachable" && "Snoozes this task for 30 minutes."}
            {!outcome && "Choose what happened on the call."}
          </p>
        </div>
      </div>
    </div>
  );
}
