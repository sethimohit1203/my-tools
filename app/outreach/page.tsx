"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Banner, Card, ErrorBox, Field, Shell, Stat, Tabs } from "../lib/ui";
import { readStored, useQueryParam, useStored, uid, writeStored } from "../lib/store";
import { aiJSON, api, useSettings } from "../lib/settings";
import { LEADS_KEY, PROFILES, STAGES, waLink, type Lead } from "../lib/leads";
import { renderTemplate } from "../lib/csv";

type Channel = "email" | "whatsapp";
type SeqStep = { day: number; subject: string; body: string; template?: string };
type Recipient = { leadId: string; name: string; phone: string; email: string; vars: Record<string, string>; step: number; nextDue: string; status: "active" | "replied" | "done" | "stopped" | "failed"; log: { at: string; text: string }[] };
type Campaign = { id: string; name: string; channel: Channel; steps: SeqStep[]; recipients: Recipient[]; dailyCap: number; createdAt: string };

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

const DEFAULT_STEPS: Record<Channel, SeqStep[]> = {
  whatsapp: [
    { day: 0, subject: "", body: "Hi {{name}} 👋 I'm from {{agency}}. I came across your business and noticed {{gap}}. We help {{category}} businesses get more customers online with {{service}}. Would you be open to a quick 10-min call this week?" },
    { day: 2, subject: "", body: "Hi {{name}}, just following up on my last message. Happy to share a free mini-audit of your online presence — shall I send it?" },
    { day: 5, subject: "", body: "Hi {{name}}, last note from me 🙂 If growing online enquiries is a priority this quarter, reply YES and I'll send a few ideas. Thanks!" },
  ],
  email: [
    { day: 0, subject: "Quick idea for {{name}}", body: "Hi {{name}} team,\n\nI was looking at {{category}} businesses in your area and noticed {{gap}}.\n\nAt {{agency}} we help businesses like yours with {{service}} — usually leading to more calls and enquiries within a few weeks.\n\nWould you be open to a short call this week? I can also send a free audit.\n\nBest regards,\n{{agency}}" },
    { day: 3, subject: "Re: Quick idea for {{name}}", body: "Hi again,\n\nJust bumping this up — I put together a few specific suggestions for {{name}}. Want me to send them over?\n\nThanks,\n{{agency}}" },
    { day: 7, subject: "Should I close your file?", body: "Hi {{name}} team,\n\nI haven't heard back, so I'll assume now isn't the right time. If that changes, just reply to this email.\n\nAll the best,\n{{agency}}" },
  ],
};

export default function OutreachPage() {
  const ch = useQueryParam("ch");
  const [settings] = useSettings();
  const [channel, setChannel] = useState<Channel>("whatsapp");
  useEffect(() => { if (ch === "email" || ch === "whatsapp") void Promise.resolve().then(() => setChannel(ch)); }, [ch]);
  const [leads] = useStored<Lead[]>(LEADS_KEY, []);
  const [campaigns, setCampaigns] = useStored<Campaign[]>("outreach-campaigns", []);
  const [tab, setTab] = useState<"new" | "campaigns">("new");
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<SeqStep[] | null>(null);
  const [stage, setStage] = useState("New");
  const [profile, setProfile] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [aiPersonalize, setAiPersonalize] = useState(true);
  const [cap, setCap] = useState(25);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openId, setOpenId] = useState("");

  const seq = steps || DEFAULT_STEPS[channel];
  const apiReady = channel === "email" ? !!(settings.resendKey && settings.emailFrom) : !!(settings.waToken && settings.waPhoneId);
  const audience = useMemo(() => leads.filter((l) => (!stage || l.stage === stage) && (!profile || l.profile === profile) && l.leadScore >= minScore && (channel === "email" ? !!(l.email || l.audit?.emails?.[0]) : !!l.phone)), [leads, stage, profile, minScore, channel]);

  function varsFor(l: Lead): Record<string, string> {
    const gap = !l.website ? "you don't have a website yet" : l.audit && l.audit.score < 60 ? `your website could be faster and more mobile-friendly (it scores ${l.audit.score}/100)` : l.audit && !l.audit.hasWhatsApp ? "there's no WhatsApp chat button on your website" : "a few quick wins in your Google presence";
    return { name: l.name, category: l.category || "local", city: l.address.split(",").slice(-2, -1)[0]?.trim() || "", website: l.website, phone: l.phone, rating: String(l.ratingValue ?? ""), agency: settings.agencyName || "our agency", service: l.opportunities.slice(0, 2).join(" & ") || "a professional website", gap, pitch: l.ai?.pitch || "" };
  }

  async function createCampaign() {
    if (!audience.length) { setError("No leads match — adjust filters or save leads from Lead Finder first."); return; }
    setError(""); setBusy("Preparing campaign…");
    const recips: Recipient[] = audience.map((l) => ({ leadId: l.id, name: l.name, phone: l.phone, email: l.email || l.audit?.emails?.[0] || "", vars: varsFor(l), step: 0, nextDue: today(), status: "active", log: [] }));
    if (aiPersonalize) {
      try {
        for (let i = 0; i < recips.length; i += 12) {
          setBusy(`AI personalising openers ${i + 1}–${Math.min(i + 12, recips.length)} of ${recips.length}…`);
          const batch = recips.slice(i, i + 12);
          const r = await aiJSON<{ items: { i: number; gap: string; pitch: string }[] }>(`For each business write: "gap" = one specific, polite observation about their online presence (max 15 words, lowercase start, no greeting) and "pitch" = a personalised 1-line opener. Agency: ${settings.agencyName}. Return {"items":[{"i","gap","pitch"}]}.\n${JSON.stringify(batch.map((b, j) => ({ i: i + j, ...b.vars })))}`);
          for (const it of r.items || []) if (recips[it.i]) { if (it.gap) recips[it.i].vars.gap = it.gap; if (it.pitch) recips[it.i].vars.pitch = it.pitch; }
        }
      } catch (e) { setNotice("AI personalisation skipped: " + (e as Error).message); }
    }
    const c: Campaign = { id: uid(), name: name || `${channel === "email" ? "Email" : "WhatsApp"} · ${stage || "all"} · ${today()}`, channel, steps: seq, recipients: recips, dailyCap: cap, createdAt: new Date().toISOString() };
    setCampaigns((x) => [c, ...x]);
    setOpenId(c.id); setTab("campaigns"); setBusy("");
    setNotice(`Campaign created with ${recips.length} recipients. Click “Send due now” to start.`);
  }

  const updRecipient = (cid: string, leadId: string, p: Partial<Recipient>) => setCampaigns((all) => all.map((c) => c.id !== cid ? c : { ...c, recipients: c.recipients.map((r) => r.leadId === leadId ? { ...r, ...p } : r) }));

  function crmLog(leadId: string, chn: string, text: string, stagePatch?: Lead["stage"]) {
    const all = readStored<Lead[]>(LEADS_KEY, []);
    writeStored(LEADS_KEY, all.map((l) => l.id !== leadId ? l : { ...l, stage: stagePatch || (l.stage === "New" ? "Contacted" : l.stage), history: [...(l.history || []), { at: new Date().toISOString(), channel: chn, text }] }));
  }

  function advance(c: Campaign, r: Recipient, text: string) {
    const next = r.step + 1;
    const done = next >= c.steps.length;
    updRecipient(c.id, r.leadId, { step: next, status: done ? "done" : "active", nextDue: done ? "" : addDays(today(), c.steps[next].day - c.steps[r.step].day), log: [...r.log, { at: new Date().toISOString(), text }] });
    crmLog(r.leadId, c.channel === "email" ? "Email" : "WhatsApp", text);
  }

  async function sendDue(c: Campaign) {
    const due = c.recipients.filter((r) => r.status === "active" && r.nextDue && r.nextDue <= today()).slice(0, c.dailyCap);
    if (!due.length) { setNotice("Nothing due today."); return; }
    if (!apiReady) { setNotice(`${due.length} messages due — use the “Send” buttons below (opens ${c.channel === "email" ? "your mail app" : "WhatsApp"} with the message ready).`); setOpenId(c.id); return; }
    setError("");
    let ok = 0;
    for (const [n, r] of due.entries()) {
      setBusy(`Sending ${n + 1}/${due.length}…`);
      const st = c.steps[r.step];
      const body = renderTemplate(st.body, r.vars);
      try {
        if (c.channel === "email") await api("/api/email", { apiKey: settings.resendKey, from: settings.emailFrom, to: r.email, subject: renderTemplate(st.subject, r.vars), text: body });
        else await api("/api/whatsapp", { token: settings.waToken, phoneId: settings.waPhoneId, to: r.phone, text: body, template: st.template ? { name: st.template, params: [r.vars.name, settings.agencyName] } : undefined });
        advance(c, r, `Step ${r.step + 1} sent`); ok++;
      } catch (e) {
        updRecipient(c.id, r.leadId, { status: "failed", log: [...r.log, { at: new Date().toISOString(), text: "❌ " + (e as Error).message }] });
      }
      await new Promise((res) => setTimeout(res, 1200)); // gentle pacing
    }
    setBusy(""); setNotice(`Sent ${ok}/${due.length}. Failed ones show the error — fix and click Retry.`);
  }

  return (
    <Shell icon={channel === "email" ? "📧" : "💬"} title={channel === "email" ? "Email Automation" : "WhatsApp Automation"} wide
      desc={<>Personalised outreach to your <Link href="/crm">CRM</Link> leads with automatic follow-up sequences (e.g. day 0 → day 2 → day 5) and status tracking. Replies stop the sequence and move the lead to “Interested”.</>}>
      <div className="tk-row" style={{ marginBottom: 12 }}>
        <button className={`tk-tab${channel === "whatsapp" ? " on" : ""}`} onClick={() => { setChannel("whatsapp"); setSteps(null); }}>💬 WhatsApp</button>
        <button className={`tk-tab${channel === "email" ? " on" : ""}`} onClick={() => { setChannel("email"); setSteps(null); }}>📧 Email</button>
      </div>
      {channel === "whatsapp"
        ? <Banner tone={apiReady ? "ok" : "warn"}>{apiReady ? "✅ WhatsApp Business Cloud API connected — messages send automatically." : "No WhatsApp Cloud API keys in ⚙ Settings — you'll get one-click wa.me buttons instead (you press send in WhatsApp)."} Use the official API only, contact people who&apos;d reasonably expect it, and honour opt-outs. Meta requires an <b>approved template</b> for the first message to someone who hasn&apos;t messaged you in 24h — put its name in the step&apos;s “Template” field.</Banner>
        : <Banner tone={apiReady ? "ok" : "warn"}>{apiReady ? "✅ Resend connected — emails send automatically from " + settings.emailFrom : "No Resend key / From address in ⚙ Settings — you'll get mailto buttons instead."} Keep volumes modest, personalise, and include a way to opt out.</Banner>}

      <Tabs value={tab} onChange={setTab} items={[{ id: "new", label: "➕ New campaign" }, { id: "campaigns", label: `📬 Campaigns (${campaigns.filter((c) => c.channel === channel).length})` }]} />
      <ErrorBox error={error} />
      {notice && <Banner tone="ok">{notice}</Banner>}

      {tab === "new" && (
        <>
          <Card title="1. Audience (from CRM)">
            <div className="tk-grid" style={{ ["--min" as string]: "170px" }}>
              <Field label="Stage"><select className="tk-select" value={stage} onChange={(e) => setStage(e.target.value)}><option value="">Any</option>{STAGES.map((s) => <option key={s}>{s}</option>)}</select></Field>
              <Field label="Business"><select className="tk-select" value={profile} onChange={(e) => setProfile(e.target.value)}><option value="">All</option>{Object.entries(PROFILES).map(([k, p]) => <option key={k} value={k}>{p.icon} {p.label}</option>)}</select></Field>
              <Field label="Min lead score"><input className="tk-input" type="number" value={minScore} onChange={(e) => setMinScore(+e.target.value)} /></Field>
              <Field label="Daily send cap"><input className="tk-input" type="number" value={cap} onChange={(e) => setCap(+e.target.value)} /></Field>
            </div>
            <p className="tk-muted">{audience.length} leads with {channel === "email" ? "an email" : "a phone number"} match. {!leads.length && <Link href="/gmaps">Find leads →</Link>}</p>
          </Card>
          <Card title="2. Sequence" actions={<button className="tk-btn sm" onClick={() => setSteps([...seq, { day: (seq.at(-1)?.day || 0) + 3, subject: "", body: "" }])}>+ Follow-up</button>}>
            <p className="tk-muted">Variables: {"{{name}} {{category}} {{city}} {{website}} {{service}} {{gap}} {{pitch}} {{agency}} {{rating}}"}</p>
            {seq.map((st, i) => (
              <div key={i} className="tk-card" style={{ background: "var(--hover)" }}>
                <div className="tk-row" style={{ marginBottom: 8 }}>
                  <b>{i === 0 ? "First message" : `Follow-up ${i}`}</b>
                  <span className="tk-muted">send on day</span>
                  <input className="tk-input" type="number" style={{ width: 70 }} value={st.day} disabled={i === 0} onChange={(e) => setSteps(seq.map((x, j) => (j === i ? { ...x, day: +e.target.value } : x)))} />
                  {i > 0 && <button className="tk-btn sm danger" onClick={() => setSteps(seq.filter((_, j) => j !== i))}>✕</button>}
                </div>
                {channel === "email" && <input className="tk-input" style={{ marginBottom: 6 }} placeholder="Subject" value={st.subject} onChange={(e) => setSteps(seq.map((x, j) => (j === i ? { ...x, subject: e.target.value } : x)))} />}
                <textarea className="tk-textarea" value={st.body} onChange={(e) => setSteps(seq.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} />
                {channel === "whatsapp" && <input className="tk-input" style={{ marginTop: 6 }} placeholder="Approved template name (Cloud API, optional)" value={st.template || ""} onChange={(e) => setSteps(seq.map((x, j) => (j === i ? { ...x, template: e.target.value } : x)))} />}
              </div>
            ))}
          </Card>
          <Card title="3. Launch">
            <div className="tk-row">
              <input className="tk-input" style={{ maxWidth: 320 }} placeholder="Campaign name" value={name} onChange={(e) => setName(e.target.value)} />
              <label className="tk-row" style={{ fontSize: 13 }}><input type="checkbox" checked={aiPersonalize} onChange={(e) => setAiPersonalize(e.target.checked)} /> 🤖 AI-personalise {"{{gap}}"} & {"{{pitch}}"} per lead</label>
              <button className="tk-btn primary" disabled={!!busy} onClick={createCampaign}>Create campaign</button>
              {busy && <span className="tk-muted">⏳ {busy}</span>}
            </div>
            {audience[0] && <div style={{ marginTop: 12 }}><b style={{ fontSize: 12 }}>Preview for {audience[0].name}:</b><pre className="tk-pre">{renderTemplate(seq[0].body, varsFor(audience[0]))}</pre></div>}
          </Card>
        </>
      )}

      {tab === "campaigns" && campaigns.filter((c) => c.channel === channel).map((c) => {
        const count = (s: Recipient["status"]) => c.recipients.filter((r) => r.status === s).length;
        const dueN = c.recipients.filter((r) => r.status === "active" && r.nextDue && r.nextDue <= today()).length;
        return (
          <Card key={c.id} title={c.name} actions={<>
            <button className="tk-btn sm primary" disabled={!!busy} onClick={() => sendDue(c)}>🚀 Send due now ({dueN})</button>
            <button className="tk-btn sm" onClick={() => setOpenId(openId === c.id ? "" : c.id)}>{openId === c.id ? "Hide" : "Recipients"}</button>
            <button className="tk-btn sm danger" onClick={() => confirm("Delete campaign?") && setCampaigns((x) => x.filter((y) => y.id !== c.id))}>🗑</button>
          </>}>
            <div className="tk-grid" style={{ ["--min" as string]: "110px" }}>
              <Stat value={c.recipients.length} label="Recipients" /><Stat value={count("active")} label="Active" /><Stat value={dueN} label="Due today" color="#d97706" />
              <Stat value={count("replied")} label="Replied" color="#16a34a" /><Stat value={count("done")} label="Sequence done" /><Stat value={count("failed")} label="Failed" color="#dc2626" />
            </div>
            {busy && <p className="tk-muted">⏳ {busy}</p>}
            {openId === c.id && (
              <div className="tk-table-wrap" style={{ marginTop: 12 }}>
                <table className="tk-table">
                  <thead><tr><th>Lead</th><th>Status</th><th>Next</th><th>Last activity</th><th></th></tr></thead>
                  <tbody>{c.recipients.map((r) => {
                    const st = c.steps[r.step];
                    const msg = st ? renderTemplate(st.body, r.vars) : "";
                    const isDue = r.status === "active" && r.nextDue <= today();
                    return (
                      <tr key={r.leadId}>
                        <td><b>{r.name}</b><div className="tk-muted">{channel === "email" ? r.email : r.phone}</div></td>
                        <td><span className={`tk-badge ${r.status === "replied" ? "green" : r.status === "failed" ? "red" : r.status === "active" ? "accent" : ""}`}>{r.status}</span></td>
                        <td>{r.status === "active" ? <>Step {r.step + 1}/{c.steps.length} · {r.nextDue}</> : "—"}</td>
                        <td className="tk-muted" style={{ maxWidth: 260 }}>{r.log.at(-1)?.text || "—"}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {isDue && !apiReady && st && (channel === "whatsapp"
                            ? <a className="tk-btn sm green" target="_blank" rel="noreferrer" href={waLink(r.phone, msg)} onClick={() => advance(c, r, `Step ${r.step + 1} sent (wa.me)`)}>💬 Send</a>
                            : <a className="tk-btn sm green" href={`mailto:${r.email}?subject=${encodeURIComponent(renderTemplate(st.subject, r.vars))}&body=${encodeURIComponent(msg)}`} onClick={() => advance(c, r, `Step ${r.step + 1} sent (mailto)`)}>📧 Send</a>)}{" "}
                          {r.status === "failed" && <button className="tk-btn sm" onClick={() => updRecipient(c.id, r.leadId, { status: "active", nextDue: today() })}>Retry</button>}{" "}
                          {["active", "done"].includes(r.status) && <button className="tk-btn sm" onClick={() => { updRecipient(c.id, r.leadId, { status: "replied", nextDue: "" }); crmLog(r.leadId, channel, "Replied ✓", "Interested"); }}>✅ Replied</button>}{" "}
                          {r.status === "active" && <button className="tk-btn sm danger" onClick={() => updRecipient(c.id, r.leadId, { status: "stopped", nextDue: "" })}>Stop</button>}
                        </td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
    </Shell>
  );
}
