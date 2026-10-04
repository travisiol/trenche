import { json, readBody, route } from "@/server/api";
import { createCto, listCtos } from "@/server/cto";
import type { CtoCreateRequest, CtoListResponse, CtoResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET: every CTO (watching ones expire 1 h after creation) */
export const GET = route(async () => {
  const res: CtoListResponse = { ctos: listCtos() };
  return json(res);
});

/** POST CtoCreateRequest → { cto }: token mint (ready) or dev wallet (watched 1 h); tasks with autoStart fire once the mint is known */
export const POST = route(async (req: Request) => {
  const body = await readBody<CtoCreateRequest>(req);
  const res: CtoResponse = { cto: await createCto(body) };
  return json(res);
});
