"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { sendJson } from "@/lib/client/api";

export function DeleteOrderButton({ orderId, merchant }: { orderId: string; merchant: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!confirm(`Delete the ${merchant} order and its payment history? This can't be undone.`)) return;
    setBusy(true);
    const result = await sendJson("DELETE", `/api/orders/${orderId}`);
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    router.push("/orders");
    router.refresh();
  }

  return (
    <span className="flex items-center gap-2">
      <Button variant="ghost" onClick={remove} disabled={busy} className="text-danger">
        {busy ? "Deleting…" : "Delete"}
      </Button>
      {error ? <span role="alert" className="text-caption text-danger">{error}</span> : null}
    </span>
  );
}
