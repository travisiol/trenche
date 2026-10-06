import { spawn } from "node:child_process";
import { json, route } from "@/server/api";
import { requireUnlocked } from "@/server/engine";
import { evmAccount, rhDir } from "@/server/robinhood/wallet";

export const dynamic = "force-dynamic";

/** open the Robinhood wallet folder in the file explorer of this machine */
export const POST = route(async () => {
  requireUnlocked();
  evmAccount(); // the folder exists once the wallet does
  const dir = rhDir();
  const cmd = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  spawn(cmd, [dir], { detached: true, stdio: "ignore" }).unref();
  return json({ ok: true, folder: dir });
});
