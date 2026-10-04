import { json, route } from "@/server/api";
import { dashboard } from "@/server/dashboard";

export const dynamic = "force-dynamic";

export const GET = route(async () => json(await dashboard()));
