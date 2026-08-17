import { RoadmapCard } from "@/components/admin/roadmap-card";

export default function AdminAuditPage() {
  return (
    <div className="px-7 py-8">
      <RoadmapCard
        title="Audit Log"
        blurb="The log itself is already being written (every billing change, every client created) — this is just the screen to browse it:"
        items={[
          "Filter by client, staff member, or action type",
          "Every impersonation session, once that ships",
          "Nothing to reconstruct after the fact — it's captured from day one",
        ]}
      />
    </div>
  );
}
