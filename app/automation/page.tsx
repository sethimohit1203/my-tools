"use client";
import { useEffect, useState } from "react";
import { Banner, Card, CopyButton, ErrorBox, Field, Shell, Tabs } from "../lib/ui";
import { useQueryParam, useStored, uid, writeStored } from "../lib/store";
import { api, secretsFrom, useSettings } from "../lib/settings";
import { STEP_CATALOG, type RunLog, type Step, type StepType, type Trigger, type Workflow } from "../lib/workflow-types";
import { APPS_SCRIPT } from "../lib/apps-script";

const TRIGGERS: Record<Trigger, { icon: string; label: string; desc: string }> = {
  manual: { icon: "▶️", label: "Manual", desc: "Run from this page with the sample input." },
  webhook: { icon: "🪝", label: "Webhook", desc: "Any app POSTs JSON to the workflow's URL → it runs. Needs Deploy." },
  sheet_row: { icon: "📋", label: "New Google Sheet row", desc: "Apps Script posts each new row to the webhook. Needs Deploy." },
  schedule: { icon: "⏰", label: "Daily schedule", desc: "Runs once a day (Vercel cron, 09:00 IST) with the sample input. Needs Deploy." },
};

const s = (id: string, type: StepType, name: string, config: Record<string, string>): Step => ({ id, type, name, config });

const TEMPLATES: { name: string; desc: string; wf: Omit<Workflow, "id" | "updatedAt" | "enabled"> }[] = [
  {
    name: "New lead → AI score → WhatsApp + Email + Sheet", desc: "Sheet row / form submission → AI qualifies → if HOT send WhatsApp & email, always log to Sheets.",
    wf: { name: "Lead follow-up", trigger: "sheet_row", sampleInput: JSON.stringify({ name: "ABC Coaching Centre", phone: "9876543210", email: "abc@example.com", website: "", category: "coaching centre", city: "Delhi" }, null, 2), steps: [
      s("a", "ai", "qualify", { prompt: "Business: {{input.name}} ({{input.category}}, {{input.city}}). Website: {{input.website}}.\nReturn JSON {\"score\":0-100,\"temperature\":\"HOT|WARM|COLD\",\"service\":\"best service to pitch\",\"message\":\"friendly 3-line WhatsApp intro from Designoia mentioning the service\"}", json: "json" }),
      s("b", "sheets", "log", { action: "append", sheet: "Leads", row: "{\"Name\":\"{{input.name}}\",\"Phone\":\"{{input.phone}}\",\"Score\":\"{{steps.qualify.score}}\",\"Temp\":\"{{steps.qualify.temperature}}\",\"Service\":\"{{steps.qualify.service}}\",\"Date\":\"{{now}}\"}" }),
      s("c", "condition", "only hot", { left: "{{steps.qualify.temperature}}", op: "equals", right: "HOT", onFalse: "stop" }),
      s("d", "whatsapp", "whatsapp", { to: "{{input.phone}}", text: "{{steps.qualify.message}}", template: "", params: "" }),
      s("e", "email", "email", { to: "{{input.email}}", subject: "Quick idea for {{input.name}}", body: "{{steps.qualify.message}}\n\n— Team Designoia" }),
    ] },
  },
  {
    name: "Topic → AI blog → WordPress draft", desc: "Webhook/Sheet sends a topic, AI writes the article, it's saved as a WordPress draft with Rank Math meta.",
    wf: { name: "Auto blog", trigger: "webhook", sampleInput: JSON.stringify({ topic: "Benefits of coding classes for kids", keyword: "coding classes for kids" }, null, 2), steps: [
      s("a", "ai", "blog", { prompt: "Write an SEO blog post about \"{{input.topic}}\" targeting \"{{input.keyword}}\". Return JSON {\"title\",\"html\":\"article HTML with h2/h3/p/ul\",\"metaDescription\"}", json: "json" }),
      s("b", "wordpress", "post", { action: "create_post", title: "{{steps.blog.title}}", content: "{{steps.blog.html}}", status: "draft", meta: "{\"rank_math_description\":\"{{steps.blog.metaDescription}}\",\"rank_math_focus_keyword\":\"{{input.keyword}}\"}" }),
    ] },
  },
  {
    name: "Daily uptime alert", desc: "Every day: check a website, email you only if it's down.",
    wf: { name: "Uptime alert", trigger: "schedule", sampleInput: JSON.stringify({ url: "https://designoia.com", alertTo: "you@example.com" }, null, 2), steps: [
      s("a", "monitor", "check", { url: "{{input.url}}" }),
      s("b", "condition", "is down", { left: "{{steps.check.up}}", op: "equals", right: "false", onFalse: "stop" }),
      s("c", "email", "alert", { to: "{{input.alertTo}}", subject: "🔴 {{input.url}} is DOWN", body: "Status {{steps.check.status}} — {{steps.check.error}}" }),
    ] },
  },
  {
    name: "Website audit → AI report → email client", desc: "Audit a client's site, AI writes a plain-English report, email it.",
    wf: { name: "Audit report", trigger: "manual", sampleInput: JSON.stringify({ website: "example.com", client: "ABC Ltd", email: "client@example.com" }, null, 2), steps: [
      s("a", "audit", "audit", { url: "{{input.website}}" }),
      s("b", "ai", "report", { prompt: "Write a friendly monthly website health report for {{input.client}}. Audit data: score {{steps.audit.score}}/100, category scores {{steps.audit.categoryScores}}, failed checks {{steps.audit.checks}}. Summary, top 5 fixes, next steps.", json: "text" }),
      s("c", "email", "send", { to: "{{input.email}}", subject: "Website report for {{input.client}}", body: "{{steps.report}}" }),
    ] },
  },
  {
    name: "Forward to n8n / Make", desc: "Enrich the payload with AI, then POST it to another automation tool.",
    wf: { name: "AI → n8n", trigger: "webhook", sampleInput: JSON.stringify({ text: "Customer asked about price of website for a restaurant" }, null, 2), steps: [
      s("a", "ai", "classify", { prompt: "Classify this enquiry. Return JSON {\"intent\",\"service\",\"urgency\":\"low|medium|high\",\"reply\"}. Enquiry: {{input.text}}", json: "json" }),
      s("b", "http", "n8n", { method: "POST", url: "https://your-n8n.example.com/webhook/xyz", body: "{\"input\": {{input}}, \"ai\": {{steps.classify}}}", headers: "" }),
    ] },
  },
];

const blank = (): Workflow => ({ id: uid(), name: "New workflow", trigger: "manual", sampleInput: "{\n  \"name\": \"Test\"\n}", steps: [], enabled: true, updatedAt: new Date().toISOString() });

export default function AutomationPage() {
  const [settings] = useSettings();
  const qTab = useQueryParam("tab");
  const [tab, setTab] = useState<"build" | "webhooks" | "templates">("build");
  const [flows, setFlows] = useStored<Workflow[]>("workflows", []);
  const [activeId, setActiveId] = useStored<string>("workflow-active", "");
  const [token] = useStored<string>("workflow-token", "");
  const [runLog, setRunLog] = useState<RunLog[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [kv, setKv] = useState<boolean | null>(null);
  const [origin, setOrigin] = useState("");
  const [deployed, setDeployed] = useStored<Record<string, string>>("workflow-deployed", {});

  useEffect(() => {
    void (async () => {
      setOrigin(window.location.origin);
      const r = await fetch("/api/workflows").then((x) => x.json()).catch(() => ({ enabled: false }));
      setKv(!!r.enabled);
    })();
  }, []);
  useEffect(() => { if (qTab === "webhooks" || qTab === "templates") void Promise.resolve().then(() => setTab(qTab)); }, [qTab]);

  const wf = flows.find((f) => f.id === activeId) || flows[0];
  const save = (p: Partial<Workflow>) => wf && setFlows(flows.map((f) => (f.id === wf.id ? { ...f, ...p, updatedAt: new Date().toISOString() } : f)));
  const setStep = (id: string, p: Partial<Step>) => wf && save({ steps: wf.steps.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const move = (i: number, d: number) => { if (!wf) return; const a = [...wf.steps]; const [x] = a.splice(i, 1); a.splice(i + d, 0, x); save({ steps: a }); };

  function create(from?: Omit<Workflow, "id" | "updatedAt" | "enabled">) {
    const n = { ...blank(), ...(from ? JSON.parse(JSON.stringify(from)) : {}) } as Workflow;
    setFlows([...flows, n]); setActiveId(n.id); setTab("build"); setRunLog(null);
  }
  function addStep(type: StepType) {
    if (!wf) return;
    const n = wf.steps.filter((x) => x.type === type).length + 1;
    save({ steps: [...wf.steps, { id: uid(), type, name: `${type}${n}`, config: {} }] });
  }

  async function run() {
    if (!wf) return;
    let input: unknown;
    try { input = JSON.parse(wf.sampleInput || "{}"); } catch { setError("Sample input is not valid JSON."); return; }
    setBusy("Running…"); setError(""); setRunLog(null);
    try {
      const r = await api<{ ok: boolean; log: RunLog[] }>("/api/workflow/run", { workflow: wf, input, secrets: secretsFrom(settings) });
      setRunLog(r.log);
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  function ensureToken() {
    if (token) return token;
    const t = uid() + uid();
    writeStored("workflow-token", t);
    return t;
  }

  async function deploy(on = true) {
    if (!wf) return;
    setBusy("Deploying…"); setError(""); setNotice("");
    try {
      const t = ensureToken();
      await fetch("/api/workflows", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflow: { ...wf, enabled: on }, secrets: secretsFrom(settings), token: t }) }).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); });
      save({ enabled: on });
      setDeployed({ ...deployed, [wf.id]: new Date().toISOString() });
      setNotice(on ? "Deployed ✓ — the webhook URL and schedule are live." : "Paused.");
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  const hookUrl = wf ? `${origin}/api/hooks/${wf.id}?key=${token || "(deploy first)"}` : "";

  return (
    <Shell icon="🔄" title="Workflow Builder" wide desc="Trigger → Action → Condition → Action — a lightweight n8n. Pass data between steps with {{input.field}}, {{steps.<step name>}}, {{steps.<name>.field}}, {{vars.x}} and {{now}}. Keys come from ⚙ Settings.">
      <Tabs value={tab} onChange={setTab} items={[{ id: "build", label: "🛠 Builder" }, { id: "templates", label: "📚 Templates" }, { id: "webhooks", label: "🪝 Webhooks & API" }]} />

      {tab === "templates" && (
        <div className="tk-grid" style={{ ["--min" as string]: "320px" }}>
          {TEMPLATES.map((t) => (
            <Card key={t.name} title={t.name}>
              <p className="tk-muted">{t.desc}</p>
              <div className="tk-row" style={{ marginBottom: 10 }}>
                <span className="tk-badge accent">{TRIGGERS[t.wf.trigger].icon} {TRIGGERS[t.wf.trigger].label}</span>
                {t.wf.steps.map((x) => <span key={x.id} className="tk-badge">→ {STEP_CATALOG[x.type].icon} {x.name}</span>)}
              </div>
              <button className="tk-btn primary sm" onClick={() => create(t.wf)}>Use template</button>
            </Card>
          ))}
        </div>
      )}

      {tab === "webhooks" && (
        <>
          <Banner tone={kv ? "ok" : "warn"}>{kv ? "✅ Storage connected — deployed workflows can be triggered by webhook and the daily schedule." : "Webhooks and schedules need free storage: Vercel → your project → Storage → Create → Upstash Redis (KV) → connect, then redeploy. Manual runs work without it."}</Banner>
          <Card title="How to trigger a workflow from other apps">
            <p className="tk-muted">Deploy a workflow (Builder tab → 🚀 Deploy). Then send JSON to its URL — the JSON becomes <code>{"{{input}}"}</code>:</p>
            <pre className="tk-pre tk-code">{`curl -X POST "${origin}/api/hooks/<workflow-id>?key=<your-key>" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"ABC School","phone":"9876543210"}'`}</pre>
            <p className="tk-muted">GET also works: <code>{origin}/api/hooks/&lt;id&gt;?key=…&amp;name=ABC</code>. Use it from n8n (HTTP Request), Make, Zapier, Google Forms (Apps Script), WordPress forms (webhook add-ons), Razorpay, Typeform, etc.</p>
          </Card>
          <Card title="Deployed workflows">
            {flows.filter((f) => deployed[f.id]).map((f) => (
              <div key={f.id} className="tk-check"><span>{f.enabled ? "🟢" : "⏸"}</span><div style={{ flex: 1 }}><b>{f.name}</b> <span className="tk-muted">({TRIGGERS[f.trigger].label})</span><div className="tk-code" style={{ wordBreak: "break-all" }}>{origin}/api/hooks/{f.id}?key={token}</div></div><CopyButton text={`${origin}/api/hooks/${f.id}?key=${token}`} /></div>
            ))}
            {!Object.keys(deployed).length && <span className="tk-muted">Nothing deployed yet.</span>}
          </Card>
          <Card title="📋 Google Sheets trigger (Apps Script)" actions={<CopyButton text={APPS_SCRIPT} label="Copy script" />}>
            <p className="tk-muted">Paste into your sheet&apos;s Extensions → Apps Script. Set <code>WORKFLOW_WEBHOOK</code> to your workflow URL and add an “On change” trigger for <code>onRowAdded</code>. The same script lets the tools write rows to your sheet.</p>
            <pre className="tk-pre tk-code" style={{ maxHeight: 280, overflow: "auto" }}>{APPS_SCRIPT}</pre>
          </Card>
        </>
      )}

      {tab === "build" && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(200px, 240px) 1fr", gap: 14, alignItems: "start" }}>
          <Card title="Workflows">
            {flows.map((f) => (
              <button key={f.id} className={`tk-tab${wf?.id === f.id ? " on" : ""}`} style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 6 }} onClick={() => { setActiveId(f.id); setRunLog(null); }}>
                {TRIGGERS[f.trigger].icon} {f.name}
              </button>
            ))}
            <button className="tk-btn sm primary" onClick={() => create()}>+ New</button>{" "}
            <button className="tk-btn sm" onClick={() => setTab("templates")}>📚 Templates</button>
          </Card>

          {!wf ? <Banner tone="info">Create a workflow or start from a template.</Banner> : (
            <div>
              <Card>
                <div className="tk-grid" style={{ ["--min" as string]: "220px" }}>
                  <Field label="Name"><input className="tk-input" value={wf.name} onChange={(e) => save({ name: e.target.value })} /></Field>
                  <Field label="Trigger" hint={TRIGGERS[wf.trigger].desc}>
                    <select className="tk-select" value={wf.trigger} onChange={(e) => save({ trigger: e.target.value as Trigger })}>
                      {(Object.keys(TRIGGERS) as Trigger[]).map((t) => <option key={t} value={t}>{TRIGGERS[t].icon} {TRIGGERS[t].label}</option>)}
                    </select>
                  </Field>
                </div>
                <div style={{ marginTop: 10 }}><Field label="Sample / scheduled input (JSON) — available as {{input.*}}"><textarea className="tk-textarea tk-code" value={wf.sampleInput} onChange={(e) => save({ sampleInput: e.target.value })} /></Field></div>
                <div className="tk-row" style={{ marginTop: 10 }}>
                  <button className="tk-btn green" disabled={!!busy || !wf.steps.length} onClick={run}>▶ Run now</button>
                  {wf.trigger !== "manual" && <button className="tk-btn primary" disabled={!!busy || kv === false} onClick={() => deploy(true)}>🚀 Deploy{deployed[wf.id] ? " (update)" : ""}</button>}
                  {deployed[wf.id] && <button className="tk-btn" disabled={!!busy} onClick={() => deploy(!wf.enabled)}>{wf.enabled ? "⏸ Pause" : "▶ Resume"}</button>}
                  <button className="tk-btn danger" onClick={() => { if (confirm("Delete workflow?")) { setFlows(flows.filter((f) => f.id !== wf.id)); if (deployed[wf.id]) fetch("/api/workflows", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: wf.id, token }) }); } }}>🗑 Delete</button>
                  {busy && <span className="tk-muted">⏳ {busy}</span>}
                </div>
                {wf.trigger !== "manual" && deployed[wf.id] && <div className="tk-row" style={{ marginTop: 10 }}><span className="tk-code" style={{ wordBreak: "break-all", fontSize: 11 }}>{hookUrl}</span><CopyButton text={hookUrl} label="Copy webhook" /></div>}
                {wf.trigger !== "manual" && kv === false && <Banner tone="warn">Deploying needs Upstash Redis storage connected in Vercel (see 🪝 Webhooks tab).</Banner>}
                {deployed[wf.id] && <p className="tk-muted">Deployed copies keep the keys from ⚙ Settings at deploy time — click Deploy again after editing steps or keys.</p>}
              </Card>
              <ErrorBox error={error} />
              {notice && <Banner tone="ok">{notice}</Banner>}

              <div className="tk-badge accent" style={{ marginBottom: 8 }}>{TRIGGERS[wf.trigger].icon} Trigger: {TRIGGERS[wf.trigger].label}</div>
              {wf.steps.map((st, i) => {
                const meta = STEP_CATALOG[st.type];
                return (
                  <div key={st.id}>
                    <div style={{ textAlign: "center", color: "var(--faint)" }}>↓</div>
                    <Card title={<>{meta.icon} {meta.label}</>} actions={<>
                      <button className="tk-btn sm" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                      <button className="tk-btn sm" disabled={i === wf.steps.length - 1} onClick={() => move(i, 1)}>↓</button>
                      <button className="tk-btn sm danger" onClick={() => save({ steps: wf.steps.filter((x) => x.id !== st.id) })}>✕</button>
                    </>}>
                      <p className="tk-muted" style={{ marginTop: -6 }}>{meta.desc}</p>
                      <div className="tk-grid" style={{ ["--min" as string]: "220px" }}>
                        <Field label="Step name (reference as {{steps.name}})"><input className="tk-input" value={st.name} onChange={(e) => setStep(st.id, { name: e.target.value.replace(/[^\w-]/g, "_") })} /></Field>
                        {meta.fields.map((fd) => (
                          <div key={fd.key} style={fd.type === "textarea" ? { gridColumn: "1 / -1" } : undefined}>
                            <Field label={fd.label}>
                              {fd.type === "select"
                                ? <select className="tk-select" value={st.config[fd.key] || fd.options![0]} onChange={(e) => setStep(st.id, { config: { ...st.config, [fd.key]: e.target.value } })}>{fd.options!.map((o) => <option key={o}>{o}</option>)}</select>
                                : fd.type === "textarea"
                                  ? <textarea className="tk-textarea" placeholder={fd.placeholder} value={st.config[fd.key] || ""} onChange={(e) => setStep(st.id, { config: { ...st.config, [fd.key]: e.target.value } })} />
                                  : <input className="tk-input" placeholder={fd.placeholder} value={st.config[fd.key] || ""} onChange={(e) => setStep(st.id, { config: { ...st.config, [fd.key]: e.target.value } })} />}
                            </Field>
                          </div>
                        ))}
                      </div>
                    </Card>
                  </div>
                );
              })}
              <Card title="+ Add step">
                <div className="tk-row">{(Object.keys(STEP_CATALOG) as StepType[]).map((t) => <button key={t} className="tk-btn sm" onClick={() => addStep(t)}>{STEP_CATALOG[t].icon} {STEP_CATALOG[t].label}</button>)}</div>
              </Card>

              {runLog && (
                <Card title="Run log">
                  {runLog.map((l, i) => (
                    <details key={i} className="tk-check" open={!l.ok}>
                      <summary style={{ cursor: "pointer" }}>{l.skipped ? "⏭" : l.ok ? "✅" : "❌"} <b>{l.step}</b> <span className="tk-muted">{l.type} · {l.ms}ms</span> {l.error && <span style={{ color: "var(--red)" }}>— {l.error}</span>}</summary>
                      {l.output !== undefined && <pre className="tk-pre tk-code" style={{ marginTop: 6, maxHeight: 260, overflow: "auto" }}>{typeof l.output === "string" ? l.output : JSON.stringify(l.output, null, 2)}</pre>}
                    </details>
                  ))}
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}
