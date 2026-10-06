"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useStored } from "./store";

export function Shell({ icon, title, desc, actions, children, wide }: { icon: string; title: string; desc?: ReactNode; actions?: ReactNode; children: ReactNode; wide?: boolean }) {
  const [theme, setTheme] = useStored<"light" | "dark">("tools-theme", "light");
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return (
    <main className="tk">
      <div className="tk-wrap" style={wide ? { maxWidth: 1400 } : undefined}>
        <div className="tk-head no-print">
          <div className="tk-row" style={{ gap: 12 }}>
            <Link href="/" className="tk-back">← All tools</Link>
            <h1>{icon} {title}</h1>
          </div>
          <div className="tk-row">
            {actions}
            <Link href="/settings" className="tk-btn sm">⚙ Settings</Link>
            <button className="tk-btn sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme">{theme === "dark" ? "☀️" : "🌙"}</button>
          </div>
        </div>
        {desc && <p className="tk-desc no-print">{desc}</p>}
        {children}
      </div>
    </main>
  );
}

export function Card({ title, children, actions, style }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; style?: React.CSSProperties }) {
  return (
    <section className="tk-card" style={style}>
      {(title || actions) && (
        <div className="tk-row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          {title ? <h3 style={{ margin: 0 }}>{title}</h3> : <span />}
          {actions && <div className="tk-row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <label className="tk-label">{label}</label>
      {children}
      {hint && <div className="tk-muted" style={{ marginTop: 4, fontSize: 11 }}>{hint}</div>}
    </div>
  );
}

export function Banner({ tone = "info", children }: { tone?: "info" | "ok" | "warn" | "err"; children: ReactNode }) {
  return <div className={`tk-banner ${tone}`}>{children}</div>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[] }) {
  return (
    <div className="tk-tabs no-print">
      {items.map((it) => (
        <button key={it.id} className={`tk-tab${value === it.id ? " on" : ""}`} onClick={() => onChange(it.id)}>{it.label}</button>
      ))}
    </div>
  );
}

export function Stat({ value, label, color }: { value: ReactNode; label: string; color?: string }) {
  return <div className="tk-stat"><b style={color ? { color } : undefined}>{value}</b><span>{label}</span></div>;
}

export function ScoreBadge({ score, invert }: { score: number | undefined | null; invert?: boolean }) {
  if (score == null) return <span className="tk-badge">—</span>;
  const good = invert ? score < 40 : score >= 70;
  const mid = invert ? score < 70 : score >= 45;
  return <span className={`tk-badge ${good ? "green" : mid ? "amber" : "red"}`}>{score}</span>;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="tk-btn sm" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* ignore */ }
    }}>{done ? "✓ Copied" : `📋 ${label}`}</button>
  );
}

export function ErrorBox({ error }: { error: string }) {
  if (!error) return null;
  return <Banner tone="err">⚠️ {error}</Banner>;
}

export function Spinner({ text }: { text?: string }) {
  return <span className="tk-muted">⏳ {text || "Working…"}</span>;
}
