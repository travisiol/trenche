import { redirect } from "next/navigation";

/** /rh → the Robinhood dashboard */
export default function RhHome() {
  redirect("/rh/dashboard");
}
