import { authed, body } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";
import { createPost } from "@/app/lib/server/social-posts";

export const GET = authed(async (_req, a) => ({ posts: await db()`select * from social_posts where workspace_id = ${a.workspaceId} order by coalesce(scheduled_for, created_at) desc limit 500` }));

export const POST = authed(async (req, a) => ({ post: await createPost(a.workspaceId, await body(req)) }));
