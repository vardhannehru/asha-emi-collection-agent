// Loan lookups and the plain-English payment plans the LLM is allowed to offer.
import { db } from "./db.js";
import * as rules from "./rules.js";

export function findLoan(id) {
  return db.prepare("SELECT * FROM loans WHERE id = ?").get(Number(id)) || null;
}

export function callsToday(loanId) {
  const today = rules.nowIST().date;
  return db.prepare("SELECT COUNT(*) AS n FROM calls WHERE loan_id = ? AND substr(started_at, 1, 10) = ?")
    .get(Number(loanId), today).n;
}

export function offersFor(loan, today) {
  const money = (n) => Number(n).toLocaleString("en-IN");
  const split = rules.paymentPlan("split_two_parts", loan.amount_due, today);
  const later = rules.paymentPlan("extend_due_date", loan.amount_due, today);
  const remaining = loan.amount_due - split.amount;
  return {
    pay_full_now: `Pay the full ${money(loan.amount_due)} rupees today`,
    extend_due_date: `Pay the full ${money(loan.amount_due)} rupees within ${rules.MAX_EXTENSION_DAYS} days, by ${rules.prettyDate(later.payBy)}`,
    split_two_parts: `Pay ${money(split.amount)} rupees today and the remaining ${money(remaining)} rupees within ${rules.SPLIT_SECOND_PART_DAYS} days`,
  };
}
