import { json, readBody, route } from "@/server/api";
import { createGroup, walletsResponse } from "@/server/wallets";
import type { GroupCreateRequest, GroupCreateResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const body = await readBody<GroupCreateRequest>(req);
  const group = createGroup(String(body.name ?? ""));
  const res: GroupCreateResponse = { ...walletsResponse(), group };
  return json(res);
});
