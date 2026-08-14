import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { POST } from "./route";

let tenantId: string;
let mockSession: { user: { tenantId: string; role: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

const VALID_PASSWORD = "Cashier1!";

function postRequest(body: unknown) {
  return new Request("http://localhost/api/users", { method: "POST", body: JSON.stringify(body) });
}

describe("/api/users", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Users Test Co", tradeNameEn: "Users Test Shop", vatNumber: "300000000000102" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId, role: "OWNER" } };
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("creates a Cashier account with a valid email and password", async () => {
    const response = await POST(postRequest({ email: "cashier-one@example.com", password: VALID_PASSWORD }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.email).toBe("cashier-one@example.com");
    expect(body.role).toBe("CASHIER");
    expect(body.isActive).toBe(true);
  });

  it("returns 400 for a password missing an uppercase letter", async () => {
    const response = await POST(postRequest({ email: "weak-pw@example.com", password: "lowercase1!" }));
    expect(response.status).toBe(400);
  });

  it("returns 400 for an empty email", async () => {
    const response = await POST(postRequest({ email: "   ", password: VALID_PASSWORD }));
    expect(response.status).toBe(400);
  });

  it("returns 409 for an email already in use", async () => {
    await POST(postRequest({ email: "duplicate@example.com", password: VALID_PASSWORD }));
    const response = await POST(postRequest({ email: "duplicate@example.com", password: VALID_PASSWORD }));
    expect(response.status).toBe(409);
  });

  it("returns 403 when the caller is a Cashier, not an Owner", async () => {
    mockSession = { user: { tenantId, role: "CASHIER" } };
    try {
      const response = await POST(postRequest({ email: "should-not-be-created@example.com", password: VALID_PASSWORD }));
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });

  it("returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await POST(postRequest({ email: "no-session@example.com", password: VALID_PASSWORD }));
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });
});
