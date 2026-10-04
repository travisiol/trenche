/** Trade rows (launch Activity + trade page): external buys highlighted green, external sells highlighted red,
 *  the user's own wallets shown plainly (no highlight) with a "you" chip — every trade is listed. */
export function tradeRowStyle(side: "buy" | "sell", own: boolean): { row: string; amount: string } {
  if (own) return { row: "bg-bg-100", amount: side === "buy" ? "text-green-100" : "text-decrease" };
  return side === "buy"
    ? { row: "bg-[color-mix(in_srgb,var(--green-100)_14%,var(--bg-100))] shadow-[inset_2px_0_0_var(--green-100)]", amount: "text-green-100" }
    : { row: "bg-[color-mix(in_srgb,var(--decrease)_14%,var(--bg-100))] shadow-[inset_2px_0_0_var(--decrease)]", amount: "text-decrease" };
}
