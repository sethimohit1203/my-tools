import { authed, body, HttpError } from "@/app/lib/server/http";
import { TEMPLATES } from "@/app/lib/automation/templates";
import { saveWorkflow } from "@/app/lib/server/engine/workflows";

export const GET = authed(async () => ({ templates: TEMPLATES }));

// Creates a real workflow (draft) from a template.
export const POST = authed(async (req, a) => {
  const { key, name } = await body<{ key: string; name?: string }>(req);
  const t = TEMPLATES.find((x) => x.key === key);
  if (!t) throw new HttpError(404, "Template not found");
  const wf = await saveWorkflow(a.workspaceId, a.userId, { name: name || t.name, description: `${t.desc}\n\nSetup: ${t.setup.join(" · ")}`, type: "template", definition: JSON.parse(JSON.stringify(t.definition)), template_key: t.key });
  return { workflow: wf };
});
