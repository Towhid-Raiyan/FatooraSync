import { Spinner } from "@/components/admin/spinner";

export default function AdminProtectedLoading() {
  return (
    <div className="flex items-center justify-center px-7 py-24 text-neutral-400">
      <Spinner className="size-5" />
    </div>
  );
}
