const STYLES: Record<string, string> = {
  TRIALING: "bg-amber-50 text-amber-700",
  ACTIVE: "bg-green-50 text-green-800",
  COMPLIMENTARY: "bg-blue-50 text-blue-700",
  PAST_DUE: "bg-red-50 text-red-600",
  SUSPENDED: "bg-red-100 text-red-800",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STYLES[status] ?? "bg-neutral-100 text-neutral-600"}`}>
      {status}
    </span>
  );
}
