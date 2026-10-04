import { json, route } from "@/server/api";
import { jobView } from "@/server/jobs";
import { store } from "@/server/store";
import type { JobsListResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const res: JobsListResponse = { jobs: [...store().jobs.values()].sort((a, b) => b.startedAt - a.startedAt).map(jobView) };
  return json(res);
});
