/**
 * The buyer's side of an invoice, mirrored from the backend so the NEW/EDIT forms can show a
 * running total while someone types — before anything has been saved and there is nothing to ask
 * the server about.
 *
 * The backend `InvoiceCharge` (GreenMarket.Domain/Services/InvoiceCharge.cs) is the authority:
 * it is what actually gets stored on the invoice, and this only ever previews it. Any change
 * there has to be made here too — the reason it lives in its own file with this note, rather than
 * inline in the two form pages, is that a rule written twice in one language is already how the
 * wood price ended up on two ledgers at once, and it was written a third time here in a way that
 * silently left the crate fee out of the total the forms displayed.
 *
 * Returns are not a parameter: an invoice being written cannot have any yet.
 */
export const InvoiceCharge = {
  forMerchant(totalValue: number, woodTotal: number, boxFeeTotal: number): number {
    return totalValue + woodTotal + boxFeeTotal;
  },
};

/**
 * What one line is worth: الوزن × السعر when it was weighed, otherwise العدد × السعر. Mirrors the
 * backend InvoiceCalculator.LineTotalFor for the same reason forMerchant above mirrors
 * InvoiceCharge — the form shows a running total while someone types, before there is anything to
 * ask the server about. A weight of 0 reads the same as no weight at all: nothing was weighed.
 */
export function lineTotalOf(line: { quantity: number; weightKg?: number | null; pricePerUnit: number }): number {
  const basis = line.weightKg != null && line.weightKg > 0 ? line.weightKg : line.quantity;
  return basis * line.pricePerUnit;
}
