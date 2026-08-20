import { RoadmapCard } from "@/components/admin/roadmap-card";

export default function AdminAnalyticsPage() {
  return (
    <div className="px-4 py-6 sm:px-7 sm:py-8">
      <RoadmapCard
        title="Analytics"
        blurb="Cross-client trends, once there's enough usage data to make them meaningful. Planned for this screen:"
        items={[
          "Revenue/status trend over time (TRIALING → ACTIVE conversion, churn)",
          "Per-client engagement — receipts/quotations created, last login",
          "Early warning signals for at-risk accounts (PAST_DUE, inactivity)",
        ]}
      />
    </div>
  );
}
