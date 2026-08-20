import { RoadmapCard } from "@/components/admin/roadmap-card";

export default function AdminStaffPage() {
  return (
    <div className="px-4 py-6 sm:px-7 sm:py-8">
      <RoadmapCard
        title="Staff"
        blurb="Right now it's just you, seeded directly into the database. This screen arrives once there's a second agency person:"
        items={[
          "CTO creates/removes Developer accounts",
          "Developer: support and impersonation access, no billing control",
          "CTO: full control, including this screen itself",
        ]}
      />
    </div>
  );
}
