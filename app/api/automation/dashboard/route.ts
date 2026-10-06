import { authed } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";

// Every number here is a query on real run data.
export const GET = authed(async (_req, a) => {
  const sql = db();
  const ws = a.workspaceId;
  const [wf] = await sql`select count(*) filter (where status = 'active')::int as active, count(*) filter (where status = 'paused')::int as paused, count(*)::int as total from automation_workflows where workspace_id = ${ws}`;
  const [today] = await sql`select
      count(*) filter (where status in ('queued','running'))::int as running,
      count(*) filter (where status = 'completed' and completed_at >= date_trunc('day', now()))::int as completed_today,
      count(*) filter (where status in ('failed','partially_completed') and completed_at >= date_trunc('day', now()))::int as failed_today,
      coalesce(sum(records_success + records_failed) filter (where completed_at >= date_trunc('day', now())), 0)::int as items_today,
      coalesce(sum(records_success) filter (where completed_at >= now() - interval '7 days'), 0)::int as ok7,
      coalesce(sum(records_failed) filter (where completed_at >= now() - interval '7 days'), 0)::int as bad7
    from automation_runs where workspace_id = ${ws} and is_test = false`;
  const recent = await sql`select id, workflow_id, workflow_name, kind, trigger, status, is_test, records_total, records_success, records_failed, records_skipped, started_at, completed_at, created_at, duration_ms, dispatch_error from automation_runs where workspace_id = ${ws} order by created_at desc limit 10`;
  const failed = await sql`select id, workflow_name, kind, status, records_failed, records_total, completed_at from automation_runs where workspace_id = ${ws} and is_test = false and status in ('failed','partially_completed') order by completed_at desc nulls last limit 8`;
  const scheduled = await sql`select s.*, w.name as workflow_name, w.status as workflow_status from automation_schedules s join automation_workflows w on w.id = s.workflow_id where s.workspace_id = ${ws} order by s.next_run_at nulls last limit 20`;
  const upcoming = [
    ...scheduled.filter((s) => s.status === "active" && s.next_run_at).map((s) => ({ at: s.next_run_at, what: s.workflow_name, kind: "workflow schedule", link: `/automation/workflows/${s.workflow_id}` })),
    ...(await sql`select min(scheduled_for) as at, c.name, c.id from campaign_messages m join campaigns c on c.id = m.campaign_id where m.workspace_id = ${ws} and m.status = 'queued' and c.status = 'active' group by c.name, c.id`).map((c) => ({ at: c.at, what: `Campaign: ${c.name}`, kind: "campaign send", link: `/outreach?campaign=${c.id}` })),
    ...(await sql`select next_check_at as at, coalesce(label, url) as name from monitors where workspace_id = ${ws} and status = 'active' order by next_check_at limit 5`).map((m) => ({ at: m.at, what: `Monitor: ${m.name}`, kind: "monitor check", link: "/monitor" })),
    ...(await sql`select scheduled_for as at, platform, id from social_posts where workspace_id = ${ws} and status = 'scheduled' order by scheduled_for limit 5`).map((p) => ({ at: p.at, what: `${p.platform} post`, kind: "social post", link: "/social" })),
  ].sort((x, y) => new Date(x.at as string).getTime() - new Date(y.at as string).getTime()).slice(0, 12);
  const total7 = Number(today.ok7) + Number(today.bad7);
  return {
    stats: { active: wf.active, paused: wf.paused, workflows: wf.total, running: today.running, completed_today: today.completed_today, failed_today: today.failed_today, items_today: today.items_today, success_rate_7d: total7 ? Math.round((Number(today.ok7) / total7) * 1000) / 10 : null },
    recent, failed, scheduled, upcoming,
  };
});
