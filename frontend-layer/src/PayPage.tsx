import { useEffect, useState } from "react";
import { api, post, rupees } from "./api";

type Payment = { id: number; amount: number; status: string; name: string };

const paymentId = new URLSearchParams(window.location.search).get("id");

export default function PayPage() {
  const [payment, setPayment] = useState<Payment | null>(null);
  const [paidAt, setPaidAt] = useState<Date | null>(null);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    api<Payment>(`/api/payments/${paymentId}`)
      .then((p) => {
        setPayment(p);
        if (p.status === "paid") setPaidAt(new Date());
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    // Push a new history entry to prevent going back to login
    window.history.pushState(null, "", window.location.href);

    // Prevent back button navigation
    const handlePopState = (e: PopStateEvent) => {
      e.preventDefault();
      window.history.pushState(null, "", window.location.href);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  async function pay() {
    setPaying(true);
    try {
      await post(`/api/payments/${paymentId}/mock-pay`);
      setPaidAt(new Date());
    } catch (e) {
      setError((e as Error).message);
    }
    setPaying(false);
  }

  return (
    <main className="receipt">
      <div className="card receipt-card">
        {error && <p className="notice">{error}</p>}
        {payment && !paidAt && (
          <div className="center">
            <p className="small">Test payment page - no real money moves</p>
            <p>EMI payment for {payment.name}</p>
            <p className="amount">{rupees(payment.amount)}</p>
            <button className="primary big" onClick={pay} disabled={paying}>{paying ? "Paying..." : "Pay now (test)"}</button>
          </div>
        )}
        {payment && paidAt && (
          <>
            <div className="receipt-header">
              <div className="badge-success">Payment successful</div>
              <h1>Payment receipt</h1>
              <div className="small">{paidAt.toLocaleDateString()} at {paidAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
            </div>
            <dl className="receipt-rows">
              <dt>Borrower</dt><dd>{payment.name}</dd>
              <dt>Payment ID</dt><dd>#{payment.id}</dd>
              <dt>Method</dt><dd>UPI (test mode)</dd>
              <dt className="total">Amount paid</dt><dd className="total">{rupees(payment.amount)}</dd>
            </dl>
            <p className="small">This is a demo receipt. No real money was transferred.</p>
            <div className="row">
              <button onClick={() => window.print()}>Print receipt</button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
