import { authed } from "@/app/lib/server/http";
import { googleAuthUrl } from "@/app/lib/server/google";
import { signToken } from "@/app/lib/server/crypto";

export const POST = authed(async (_req, a) => ({ url: googleAuthUrl(signToken({ w: a.workspaceId, u: a.userId, exp: Date.now() + 10 * 60000 })) }));
