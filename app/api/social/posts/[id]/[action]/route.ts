import { authed } from "@/app/lib/server/http";
import "@/app/lib/server/engine";
import { transitionPost } from "@/app/lib/server/social-posts";

export const maxDuration = 60;
export const POST = authed(async (_req, a, p) => transitionPost(a.workspaceId, p.id, p.action, a.userId));
