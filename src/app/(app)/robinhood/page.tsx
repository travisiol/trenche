import { redirect } from "next/navigation";

/** the old Robinhood page: everything Robinhood now lives in Robinhood mode (/rh/*) */
export default function RobinhoodPage() {
  redirect("/rh/portfolio");
}
