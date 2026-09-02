import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { getCreditableLines } from "@/lib/receipts/creditable-lines";
import { CreditNoteForm } from "@/components/receipts/credit-note-form";

export default async function CreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const creditable = await getCreditableLines(tenantId, id);
  if (!creditable) {
    notFound();
  }

  return (
    <CreditNoteForm
      originalDocumentId={creditable.documentId}
      documentNumber={creditable.documentNumber}
      lines={creditable.lines}
    />
  );
}
