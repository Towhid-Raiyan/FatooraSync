import { put, head } from "@vercel/blob";

// Uploads the archive, then independently re-fetches its metadata to confirm
// it actually landed -- a successful `put()` response alone is not treated
// as proof, per the delete flow's core safety requirement (spec S4.2): the
// tenant must never be deleted on the strength of an unverified upload.
export async function uploadTenantArchive(tenantId: string, buffer: Buffer): Promise<{ url: string }> {
  const pathname = `tenant-archives/${tenantId}-${Date.now()}.zip`;
  const blob = await put(pathname, buffer, { access: "public", contentType: "application/zip" });

  const verified = await head(blob.url);
  if (!verified || verified.size !== buffer.length) {
    throw new Error(`Archive upload for tenant ${tenantId} could not be verified (expected ${buffer.length} bytes)`);
  }

  return { url: blob.url };
}
