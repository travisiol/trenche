/** Trade rows (launch Activity + trade page): the user's OWN trades are highlighted — green for a buy, red for a
 *  sell — and other wallets' trades are listed plainly (amount still green/red). Every trade is listed. */
export function tradeRowStyle(side: "buy" | "sell", own: boolean): { row: string; amount: string } {
  const amount = side === "buy" ? "text-green-100" : "text-decrease";
  if (!own) return { row: "bg-bg-100", amount };
  return side === "buy"
    ? { row: "bg-[color-mix(in_srgb,var(--green-100)_16%,var(--bg-100))] shadow-[inset_2px_0_0_var(--green-100)]", amount }
    : { row: "bg-[color-mix(in_srgb,var(--decrease)_16%,var(--bg-100))] shadow-[inset_2px_0_0_var(--decrease)]", amount };
}
