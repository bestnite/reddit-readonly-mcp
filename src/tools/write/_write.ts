// 写工具共用：先校验凭据（缺失时立即报错，不进入安全模式排队），再在安全模式约束下执行。

import type { AppContext } from "../../context.js";
import type { WriteIntent } from "../../write/safe-mode.js";
import type { Query } from "../../client/reddit-client.js";
import type { RedditThing } from "../../types.js";

export interface WriteResponse {
  json?: {
    errors?: unknown[];
    data?: { things?: RedditThing[]; url?: string; id?: string; name?: string };
  };
}

export async function performWrite(
  ctx: AppContext,
  tool: string,
  intent: WriteIntent,
  path: string,
  form: Query,
): Promise<WriteResponse> {
  ctx.userAuth.assertConfigured(tool);
  return ctx.safeMode.run(intent, () =>
    ctx.client.user<WriteResponse>(path, { what: tool, tool, method: "POST", form }),
  );
}
