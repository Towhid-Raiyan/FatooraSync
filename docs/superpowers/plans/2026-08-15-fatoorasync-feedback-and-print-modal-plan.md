# System Feedback Layer & Print Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add success/failure feedback and loading indicators everywhere they're currently missing, and replace the Save & Print page-navigation flow (and the History pages' View/Download links) with a single, reusable in-page modal.

**Architecture:** A toast primitive built on Radix's own `Toast` component (already available via the existing `radix-ui` dependency, no new package) provides success confirmations app-wide. Per-action loading state (not a single page-wide flag) drives spinners on buttons that currently give no feedback. A single `PrintModal` component, fed by two new lightweight JSON endpoints that reuse extracted data-assembly logic the existing print pages/PDF routes already have, replaces four separate page-navigation flows.

**Tech Stack:** Next.js 15 App Router, `radix-ui` (Toast, Dialog — already a dependency), `lucide-react` (already a dependency, adds `Loader2Icon`/`TriangleAlertIcon` usage), Tailwind v4, Vitest.

**Design spec:** [2026-08-15-fatoorasync-feedback-and-print-modal-design.md](../specs/2026-08-15-fatoorasync-feedback-and-print-modal-design.md)

## Global Constraints

- No new npm dependencies — the toast primitive is built on `radix-ui`'s `Toast` export, already installed.
- Success gets a toast (new). Failure keeps the existing inline red-text treatment (unchanged) — the two exceptions already agreed: Settings currently has neither, and must gain both; the print modal's own load failure uses a toast (since it has no dedicated field to show inline text next to).
- Every new user-facing string is a dictionary key added to `dictionary.types.ts`, `en.ts`, and `ar.ts` together, following the existing per-feature grouping convention (a toast message for Settings lives under `dict.settings`, not a generic flat bucket).
- The standalone `/receipts/[id]/print` and `/quotations/[id]/print` pages are never deleted — only unlinked from the UI. Their PDF download routes are unchanged in behavior (only refactored internally to share code with the new endpoints).
- No change to save/mutation API logic, ZATCA hash chain, or calculation functions anywhere in this plan.
- The print components (`ReceiptPrintThermal`, `ReceiptPrintA4`, `QuotationPrintThermal`, `QuotationPrintA4`, `A4BusinessHeader`) must render identically, pixel-for-pixel, in both their existing (server-rendered, real Prisma `Decimal`/`Date` objects) and new (client-fetched, JSON-serialized) contexts. This plan widens their prop types to accept JSON-serialized values structurally (any value with a `toString()` method already works via the existing `money()` helper) rather than duplicating the components.

---

## Task 1: Toast notification primitive

**Files:**
- Create: `src/components/ui/toast.tsx`
- Create: `src/lib/toast/toast-provider.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Produces: `useToast()` hook returning `{ toast: { success(message: string): void; error(message: string): void } }` — consumed by every later task in this plan.

- [ ] **Step 1: Create the visual toast primitive**

Create `src/components/ui/toast.tsx`:

```tsx
"use client";

import { Toast as ToastPrimitive } from "radix-ui";
import { CheckIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/lib/i18n/language-provider";

export interface ToastMessage {
  id: string;
  type: "success" | "error";
  message: string;
}

export function ToastViewport({
  toasts,
  onRemove,
}: {
  toasts: ToastMessage[];
  onRemove: (id: string) => void;
}) {
  const { dict } = useLocale();

  return (
    <ToastPrimitive.Provider swipeDirection="end" duration={4000}>
      {toasts.map((t) => (
        <ToastPrimitive.Root
          key={t.id}
          className={cn(
            "flex items-start gap-2.5 rounded-xl border bg-bg-card p-3.5 pe-3 shadow-[0_4px_16px_rgba(16,44,30,0.12)]",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[swipe=end]:animate-out",
            t.type === "success" ? "border-accent-mint/40" : "border-red-200"
          )}
          onOpenChange={(open) => {
            if (!open) onRemove(t.id);
          }}
        >
          {t.type === "success" ? (
            <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
          ) : (
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-red-600" />
          )}
          <ToastPrimitive.Title className="flex-1 text-sm text-heading">{t.message}</ToastPrimitive.Title>
          <ToastPrimitive.Close aria-label={dict.a11y.close} className="text-muted-fg hover:text-heading">
            <XIcon className="size-3.5" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed top-4 end-4 z-[100] flex w-full max-w-sm flex-col gap-2 outline-none" />
    </ToastPrimitive.Provider>
  );
}
```

`top-4 end-4` places it top-end (top-right in LTR, top-left in RTL, via Tailwind's logical `end` property, matching how the rest of the app already mirrors for Arabic). `duration={4000}` on `Toast.Provider` makes Radix auto-close each `Toast.Root` after 4s, which fires `onOpenChange(false)` — the same path a manual close does.

- [ ] **Step 2: Create the provider and hook**

Create `src/lib/toast/toast-provider.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { ToastViewport, type ToastMessage } from "@/components/ui/toast";

interface ToastContextValue {
  toast: {
    success: (message: string) => void;
    error: (message: string) => void;
  };
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((type: ToastMessage["type"], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      toast: {
        success: (message: string) => push("success", message),
        error: (message: string) => push("error", message),
      },
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onRemove={remove} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
```

- [ ] **Step 3: Mount the provider at the root**

In `src/app/layout.tsx`, add the import:

```tsx
import { ToastProvider } from "@/lib/toast/toast-provider";
```

Change:

```tsx
        <LanguageProvider initialLocale={locale}>{children}</LanguageProvider>
```

to:

```tsx
        <LanguageProvider initialLocale={locale}>
          <ToastProvider>{children}</ToastProvider>
        </LanguageProvider>
```

- [ ] **Step 4: Verify the app still builds and runs**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. There is no automated test for this task — it's a visual primitive with no pure logic to unit test, and this project has no component-level test suite (confirmed: zero `*.test.tsx` files exist anywhere under `src/components/`). Verification is Task 2's manual browser check, once something actually calls `toast.success(...)`.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/toast.tsx src/lib/toast/toast-provider.tsx src/app/layout.tsx
git commit -m "Add a toast notification system for success confirmations"
```

---

## Task 2: Settings — loading state, success toast, and the missing failure check

**Files:**
- Modify: `src/components/settings/settings-client.tsx`
- Modify: `src/lib/i18n/dictionaries/dictionary.types.ts`
- Modify: `src/lib/i18n/dictionaries/en.ts`
- Modify: `src/lib/i18n/dictionaries/ar.ts`

**Interfaces:**
- Consumes: `useToast()` from `src/lib/toast/toast-provider.tsx` (Task 1).

- [ ] **Step 1: Add the new dictionary keys**

In `src/lib/i18n/dictionaries/dictionary.types.ts`, add two new keys to the end of the `settings` block (after `cashierCanManageCatalog: string;`):

```ts
    savedToast: string;
    saveError: string;
```

In `src/lib/i18n/dictionaries/en.ts`, add to the end of the `settings` block:

```ts
    savedToast: "Settings saved",
    saveError: "Couldn't save settings — please try again",
```

In `src/lib/i18n/dictionaries/ar.ts`, add to the end of the `settings` block:

```ts
    savedToast: "تم حفظ الإعدادات",
    saveError: "تعذر حفظ الإعدادات — حاول مرة أخرى",
```

- [ ] **Step 2: Run the dictionary parity test**

Run: `npx vitest run src/lib/i18n/dictionaries/dictionary-parity.test.ts`
Expected: PASS

- [ ] **Step 3: Fix the save handler — check `response.ok`, add loading state, error state, and success toast**

In `src/components/settings/settings-client.tsx`, add the import:

```tsx
import { useToast } from "@/lib/toast/toast-provider";
import { Loader2Icon } from "lucide-react";
```

Change:

```tsx
export function SettingsClient() {
  const { dict } = useLocale();
  const [defaultVatRate, setDefaultVatRate] = useState("15");
  const [language, setLanguage] = useState("ar");
  const [printFormat, setPrintFormat] = useState("THERMAL");
  const [phone, setPhone] = useState("");
  const [cashierCanManageCatalog, setCashierCanManageCatalog] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setDefaultVatRate(data.defaultVatRate);
        setLanguage(data.language);
        setPrintFormat(data.printFormat);
        setPhone(data.phone ?? "");
        setCashierCanManageCatalog(data.cashierCanManageCatalog);
        setLoaded(true);
      });
  }, []);

  async function handleSave() {
    await fetch("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ defaultVatRate, language, printFormat, phone, cashierCanManageCatalog }),
    });
  }
```

to:

```tsx
export function SettingsClient() {
  const { dict } = useLocale();
  const { toast } = useToast();
  const [defaultVatRate, setDefaultVatRate] = useState("15");
  const [language, setLanguage] = useState("ar");
  const [printFormat, setPrintFormat] = useState("THERMAL");
  const [phone, setPhone] = useState("");
  const [cashierCanManageCatalog, setCashierCanManageCatalog] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setDefaultVatRate(data.defaultVatRate);
        setLanguage(data.language);
        setPrintFormat(data.printFormat);
        setPhone(data.phone ?? "");
        setCashierCanManageCatalog(data.cashierCanManageCatalog);
        setLoaded(true);
      });
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ defaultVatRate, language, printFormat, phone, cashierCanManageCatalog }),
      });
      if (!response.ok) {
        setError(dict.settings.saveError);
        return;
      }
      toast.success(dict.settings.savedToast);
    } catch {
      setError(dict.settings.saveError);
    } finally {
      setSaving(false);
    }
  }
```

- [ ] **Step 4: Add the error message and the loading spinner to the button**

Change:

```tsx
        <Button onClick={handleSave} variant="primary" disabled={!loaded}>
          {dict.settings.saveChanges}
        </Button>
      </CardContent>
    </Card>
  );
}
```

to:

```tsx
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}

        <Button onClick={handleSave} variant="primary" disabled={!loaded || saving}>
          {saving && <Loader2Icon className="size-3.5 animate-spin" />}
          {dict.settings.saveChanges}
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Run typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS

- [ ] **Step 6: Manually verify in the browser**

Start the dev server, log in as the seeded Owner, open `/settings`. Change the VAT rate and click "Save Changes" — confirm: the button shows a spinning icon and is disabled while saving, then a success toast appears top-end reading "Settings saved" and fades in with a slide. Reload the page to confirm the change persisted (GET still worked, unaffected).

To see the failure path, temporarily stop the dev server's ability to reach the database is impractical to simulate cleanly — instead, open the browser's DevTools, go to the Network tab, and set throttling to "Offline" right before clicking Save; confirm the button returns to its normal state and the inline red error message appears instead of hanging silently. Restore the network afterward.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/settings-client.tsx src/lib/i18n/dictionaries
git commit -m "Show a loading state, success toast, and real error on Settings save"
```

---

## Task 3: Products/Customers/Staff — per-row loading and success toasts

**Files:**
- Modify: `src/components/products/products-client.tsx`
- Modify: `src/components/customers/customers-client.tsx`
- Modify: `src/components/settings/staff-section.tsx`
- Modify: `src/lib/i18n/dictionaries/dictionary.types.ts`
- Modify: `src/lib/i18n/dictionaries/en.ts`
- Modify: `src/lib/i18n/dictionaries/ar.ts`

**Interfaces:**
- Consumes: `useToast()` from `src/lib/toast/toast-provider.tsx` (Task 1).

- [ ] **Step 1: Add the new dictionary keys**

In `src/lib/i18n/dictionaries/dictionary.types.ts`, add two keys to the end of the `products` block (after `units: {...};`):

```ts
  savedToast: string;
  statusUpdatedToast: string;
```

Add two keys to the end of the `customers` block (after `dialogTitleAdd: string;`):

```ts
  savedToast: string;
  statusUpdatedToast: string;
```

Add two keys to the end of the `staff` block (after `passwordRules: {...};`):

```ts
  cashierAddedToast: string;
  statusUpdatedToast: string;
```

In `src/lib/i18n/dictionaries/en.ts`, add to the end of the `products` block:

```ts
    savedToast: "Product saved",
    statusUpdatedToast: "Product status updated",
```

to the end of the `customers` block:

```ts
    savedToast: "Customer saved",
    statusUpdatedToast: "Customer status updated",
```

to the end of the `staff` block:

```ts
    cashierAddedToast: "Cashier added",
    statusUpdatedToast: "Cashier status updated",
```

In `src/lib/i18n/dictionaries/ar.ts`, add to the end of the `products` block:

```ts
    savedToast: "تم حفظ المنتج",
    statusUpdatedToast: "تم تحديث حالة المنتج",
```

to the end of the `customers` block:

```ts
    savedToast: "تم حفظ العميل",
    statusUpdatedToast: "تم تحديث حالة العميل",
```

to the end of the `staff` block:

```ts
    cashierAddedToast: "تم إضافة الكاشير",
    statusUpdatedToast: "تم تحديث حالة الكاشير",
```

- [ ] **Step 2: Run the dictionary parity test**

Run: `npx vitest run src/lib/i18n/dictionaries/dictionary-parity.test.ts`
Expected: PASS

- [ ] **Step 3: Products — per-row loading state and success toasts**

In `src/components/products/products-client.tsx`, add the imports:

```tsx
import { Loader2Icon } from "lucide-react";
import { useToast } from "@/lib/toast/toast-provider";
```

Change:

```tsx
export function ProductsClient({
  initialProducts,
  canManageCatalog,
}: {
  initialProducts: SerializedProduct[];
  canManageCatalog: boolean;
}) {
  const { dict } = useLocale();
  const unitLabels = getUnitLabels(dict);
  const [products, setProducts] = useState(initialProducts);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialogState, setDialogState] = useState<{ open: boolean; product: SerializedProduct | null }>({
    open: false,
    product: null,
  });
```

to:

```tsx
export function ProductsClient({
  initialProducts,
  canManageCatalog,
}: {
  initialProducts: SerializedProduct[];
  canManageCatalog: boolean;
}) {
  const { dict } = useLocale();
  const { toast } = useToast();
  const unitLabels = getUnitLabels(dict);
  const [products, setProducts] = useState(initialProducts);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [dialogState, setDialogState] = useState<{ open: boolean; product: SerializedProduct | null }>({
    open: false,
    product: null,
  });
```

Change:

```tsx
  function handleSaved(product: SerializedProduct) {
    setProducts((prev) => {
      const exists = prev.some((p) => p.id === product.id);
      return exists ? prev.map((p) => (p.id === product.id ? product : p)) : [...prev, product];
    });
    setDialogState({ open: false, product: null });
  }

  async function toggleActive(product: SerializedProduct) {
    setActionError(null);
    try {
      const response = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !product.isActive }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setActionError(body.error ?? dict.common.somethingWentWrong);
        return;
      }
      const updated = await response.json();
      setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch {
      setActionError(dict.common.somethingWentWrong);
    }
  }
```

to:

```tsx
  function handleSaved(product: SerializedProduct) {
    setProducts((prev) => {
      const exists = prev.some((p) => p.id === product.id);
      return exists ? prev.map((p) => (p.id === product.id ? product : p)) : [...prev, product];
    });
    setDialogState({ open: false, product: null });
    toast.success(dict.products.savedToast);
  }

  async function toggleActive(product: SerializedProduct) {
    setActionError(null);
    setTogglingId(product.id);
    try {
      const response = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !product.isActive }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setActionError(body.error ?? dict.common.somethingWentWrong);
        return;
      }
      const updated = await response.json();
      setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      toast.success(dict.products.statusUpdatedToast);
    } catch {
      setActionError(dict.common.somethingWentWrong);
    } finally {
      setTogglingId(null);
    }
  }
```

Change the row's toggle button:

```tsx
                        <Button variant="outline" size="sm" onClick={() => toggleActive(product)}>
                          {product.isActive ? dict.common.deactivate : dict.common.reactivate}
                        </Button>
```

to:

```tsx
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={togglingId === product.id}
                          onClick={() => toggleActive(product)}
                        >
                          {togglingId === product.id && <Loader2Icon className="size-3.5 animate-spin" />}
                          {product.isActive ? dict.common.deactivate : dict.common.reactivate}
                        </Button>
```

- [ ] **Step 4: Customers — identical treatment**

In `src/components/customers/customers-client.tsx`, add the same two imports (`Loader2Icon` from `lucide-react`, `useToast` from `@/lib/toast/toast-provider`).

Change:

```tsx
export function CustomersClient({
  initialCustomers,
  canManageCatalog,
}: {
  initialCustomers: Customer[];
  canManageCatalog: boolean;
}) {
  const { dict } = useLocale();
  const [customers, setCustomers] = useState(initialCustomers);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [dialogState, setDialogState] = useState<{ open: boolean; customer: Customer | null }>({
    open: false,
    customer: null,
  });
  const [actionError, setActionError] = useState<string | null>(null);
```

to:

```tsx
export function CustomersClient({
  initialCustomers,
  canManageCatalog,
}: {
  initialCustomers: Customer[];
  canManageCatalog: boolean;
}) {
  const { dict } = useLocale();
  const { toast } = useToast();
  const [customers, setCustomers] = useState(initialCustomers);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [dialogState, setDialogState] = useState<{ open: boolean; customer: Customer | null }>({
    open: false,
    customer: null,
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
```

Change:

```tsx
  function handleSaved(customer: Customer) {
    setCustomers((prev) => {
      const exists = prev.some((c) => c.id === customer.id);
      return exists ? prev.map((c) => (c.id === customer.id ? customer : c)) : [...prev, customer];
    });
    setDialogState({ open: false, customer: null });
  }

  async function toggleActive(customer: Customer) {
    setActionError(null);
    try {
      const response = await fetch(`/api/customers/${customer.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !customer.isActive }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setActionError(body.error ?? dict.common.somethingWentWrong);
        return;
      }
      const updated = await response.json();
      setCustomers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch {
      setActionError(dict.common.somethingWentWrong);
    }
  }
```

to:

```tsx
  function handleSaved(customer: Customer) {
    setCustomers((prev) => {
      const exists = prev.some((c) => c.id === customer.id);
      return exists ? prev.map((c) => (c.id === customer.id ? customer : c)) : [...prev, customer];
    });
    setDialogState({ open: false, customer: null });
    toast.success(dict.customers.savedToast);
  }

  async function toggleActive(customer: Customer) {
    setActionError(null);
    setTogglingId(customer.id);
    try {
      const response = await fetch(`/api/customers/${customer.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !customer.isActive }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setActionError(body.error ?? dict.common.somethingWentWrong);
        return;
      }
      const updated = await response.json();
      setCustomers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      toast.success(dict.customers.statusUpdatedToast);
    } catch {
      setActionError(dict.common.somethingWentWrong);
    } finally {
      setTogglingId(null);
    }
  }
```

Change the row's toggle button:

```tsx
                        <Button variant="outline" size="sm" onClick={() => toggleActive(customer)}>
                          {customer.isActive ? dict.common.deactivate : dict.common.reactivate}
                        </Button>
```

to:

```tsx
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={togglingId === customer.id}
                          onClick={() => toggleActive(customer)}
                        >
                          {togglingId === customer.id && <Loader2Icon className="size-3.5 animate-spin" />}
                          {customer.isActive ? dict.common.deactivate : dict.common.reactivate}
                        </Button>
```

- [ ] **Step 5: Staff section — identical treatment, plus the Add Cashier toast**

In `src/components/settings/staff-section.tsx`, add the same two imports.

Change:

```tsx
export function StaffSection({ initialCashiers }: { initialCashiers: Cashier[] }) {
  const { dict } = useLocale();
  const [cashiers, setCashiers] = useState(initialCashiers);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
```

to:

```tsx
export function StaffSection({ initialCashiers }: { initialCashiers: Cashier[] }) {
  const { dict } = useLocale();
  const { toast } = useToast();
  const [cashiers, setCashiers] = useState(initialCashiers);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
```

Change:

```tsx
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/users", { method: "POST", body: JSON.stringify({ email, password }) });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? dict.common.somethingWentWrong);
        return;
      }
      setCashiers((prev) => [...prev, body]);
      setDialogOpen(false);
    } catch {
      setError(dict.common.somethingWentWrong);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(cashier: Cashier) {
    setActionError(null);
    try {
      const response = await fetch(`/api/users/${cashier.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !cashier.isActive }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setActionError(body.error ?? dict.common.somethingWentWrong);
        return;
      }
      const updated = await response.json();
      setCashiers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch {
      setActionError(dict.common.somethingWentWrong);
    }
  }
```

to:

```tsx
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/users", { method: "POST", body: JSON.stringify({ email, password }) });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? dict.common.somethingWentWrong);
        return;
      }
      setCashiers((prev) => [...prev, body]);
      setDialogOpen(false);
      toast.success(dict.staff.cashierAddedToast);
    } catch {
      setError(dict.common.somethingWentWrong);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(cashier: Cashier) {
    setActionError(null);
    setTogglingId(cashier.id);
    try {
      const response = await fetch(`/api/users/${cashier.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !cashier.isActive }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setActionError(body.error ?? dict.common.somethingWentWrong);
        return;
      }
      const updated = await response.json();
      setCashiers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      toast.success(dict.staff.statusUpdatedToast);
    } catch {
      setActionError(dict.common.somethingWentWrong);
    } finally {
      setTogglingId(null);
    }
  }
```

Change the row's toggle button:

```tsx
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" onClick={() => toggleActive(cashier)}>
                    {cashier.isActive ? dict.common.deactivate : dict.common.reactivate}
                  </Button>
                </TableCell>
```

to:

```tsx
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={togglingId === cashier.id}
                    onClick={() => toggleActive(cashier)}
                  >
                    {togglingId === cashier.id && <Loader2Icon className="size-3.5 animate-spin" />}
                    {cashier.isActive ? dict.common.deactivate : dict.common.reactivate}
                  </Button>
                </TableCell>
```

- [ ] **Step 6: Run typecheck, lint, and the full suite**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: PASS. Nothing in this task's diff is covered by an automated test (no component tests exist in this project), so this step confirms nothing else broke, not new coverage.

- [ ] **Step 7: Manually verify in the browser**

As the seeded Owner: on `/products`, deactivate then reactivate a product — confirm the clicked row's button shows a spinner and is disabled while the request is in flight, other rows' buttons stay clickable, and a success toast appears each time. Repeat on `/customers`. On `/settings`, add a Cashier — confirm a "Cashier added" toast appears after the dialog closes, then deactivate/reactivate that Cashier from the Staff table and confirm the same per-row spinner + toast behavior.

- [ ] **Step 8: Commit**

```bash
git add src/components/products/products-client.tsx src/components/customers/customers-client.tsx src/components/settings/staff-section.tsx src/lib/i18n/dictionaries
git commit -m "Add per-row loading states and success toasts to catalog and staff actions"
```

---

## Task 4: Extract print-data assembly, add the two JSON endpoints

**Files:**
- Create: `src/lib/receipts/get-print-data.ts`
- Create: `src/lib/receipts/get-print-data.test.ts`
- Create: `src/lib/quotations/get-print-data.ts`
- Create: `src/lib/quotations/get-print-data.test.ts`
- Create: `src/app/api/receipts/[id]/print-data/route.ts`
- Create: `src/app/api/receipts/[id]/print-data/route.test.ts`
- Create: `src/app/api/quotations/[id]/print-data/route.ts`
- Create: `src/app/api/quotations/[id]/print-data/route.test.ts`
- Modify: `src/app/(app)/receipts/[id]/print/page.tsx`
- Modify: `src/app/(app)/quotations/[id]/print/page.tsx`
- Modify: `src/app/api/receipts/[id]/pdf/route.tsx`
- Modify: `src/app/api/quotations/[id]/pdf/route.tsx`

**Interfaces:**
- Produces: `getReceiptPrintData(tenantId, id)` and `getQuotationPrintData(tenantId, id)`, each returning `Promise<PrintData | null>` where `PrintData = { printFormat: "THERMAL" | "A4"; tenant: Tenant; document: <document-with-lines-and-customer>; qrImageDataUrl: string | null }` — consumed by the four modified call sites in this task, and by Task 6's `PrintModal` (via the two new routes, not directly).

- [ ] **Step 1: Extract the receipt print-data helper**

Create `src/lib/receipts/get-print-data.ts`:

```ts
import QRCode from "qrcode";
import type { Customer, DocumentLine, Tenant, Document as PrismaDocument } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";

export interface ReceiptPrintData {
  printFormat: "THERMAL" | "A4";
  tenant: Tenant;
  document: PrismaDocument & { customer: Customer; lines: DocumentLine[] };
  qrImageDataUrl: string | null;
}

export async function getReceiptPrintData(tenantId: string, id: string): Promise<ReceiptPrintData | null> {
  const [document, settings] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx.document.findFirst({
        where: { id, type: "SALES_RECEIPT" },
        include: { lines: true, customer: true },
      }),
      tx.settings.findUniqueOrThrow({ where: { tenantId } }),
    ])
  );
  if (!document) return null;

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const qrImageDataUrl = document.qrCode ? await QRCode.toDataURL(document.qrCode) : null;

  return { printFormat: settings.printFormat, tenant, document, qrImageDataUrl };
}
```

- [ ] **Step 2: Write a test for it**

Create `src/lib/receipts/get-print-data.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { getReceiptPrintData } from "./get-print-data";

let tenantId: string;
let receiptId: string;

describe("getReceiptPrintData", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Print Data Test Co", tradeNameEn: "Print Data Shop", vatNumber: "300000000000140" },
    });
    tenantId = tenant.id;
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId } }));

    const customer = await withTenant(tenantId, (tx) => tx.customer.create({ data: { tenantId, name: "Print Data Customer" } }));
    const receipt = await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: {
          tenantId,
          type: "SALES_RECEIPT",
          number: 1,
          customerId: customer.id,
          subtotal: 10,
          vatTotal: 1.5,
          grandTotal: 11.5,
          qrCode: "test-qr-payload",
        },
      })
    );
    receiptId = receipt.id;
  });

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("returns the document, tenant, printFormat, and a generated QR image", async () => {
    const result = await getReceiptPrintData(tenantId, receiptId);
    expect(result).not.toBeNull();
    expect(result?.document.id).toBe(receiptId);
    expect(result?.tenant.id).toBe(tenantId);
    expect(result?.printFormat).toBe("THERMAL");
    expect(result?.qrImageDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("returns null for a nonexistent id", async () => {
    const result = await getReceiptPrintData(tenantId, "00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });

  it("returns null when the id belongs to a different tenant", async () => {
    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Other Print Data Co", tradeNameEn: "Other Print Data Shop", vatNumber: "300000000000157" },
    });
    try {
      const result = await getReceiptPrintData(otherTenant.id, receiptId);
      expect(result).toBeNull();
    } finally {
      await prisma.tenant.delete({ where: { id: otherTenant.id } });
    }
  });

  it("returns null qrImageDataUrl when the document has no qrCode", async () => {
    const customer = await withTenant(tenantId, (tx) => tx.customer.create({ data: { tenantId, name: "No QR Customer" } }));
    const receiptWithoutQr = await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: {
          tenantId,
          type: "SALES_RECEIPT",
          number: 2,
          customerId: customer.id,
          subtotal: 5,
          vatTotal: 0.75,
          grandTotal: 5.75,
        },
      })
    );
    const result = await getReceiptPrintData(tenantId, receiptWithoutQr.id);
    expect(result?.qrImageDataUrl).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test**

Run: `set -a && source .env && set +a && npx vitest run src/lib/receipts/get-print-data.test.ts`
Expected: PASS

- [ ] **Step 4: Extract the quotation print-data helper**

Create `src/lib/quotations/get-print-data.ts`:

```ts
import type { Customer, DocumentLine, Tenant, Document as PrismaDocument } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";

export interface QuotationPrintData {
  printFormat: "THERMAL" | "A4";
  tenant: Tenant;
  document: PrismaDocument & { customer: Customer; lines: DocumentLine[] };
}

export async function getQuotationPrintData(tenantId: string, id: string): Promise<QuotationPrintData | null> {
  const [document, settings] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx.document.findFirst({
        where: { id, type: "QUOTATION" },
        include: { lines: true, customer: true },
      }),
      tx.settings.findUniqueOrThrow({ where: { tenantId } }),
    ])
  );
  if (!document) return null;

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  return { printFormat: settings.printFormat, tenant, document };
}
```

No QR code — quotations never carry one (`Document.qrCode` is only ever set for `SALES_RECEIPT` rows, per the ZATCA hash-chain logic in `src/app/api/receipts/route.ts`).

- [ ] **Step 5: Write a test for it**

Create `src/lib/quotations/get-print-data.test.ts`, mirroring Step 2's shape exactly but for quotations (no QR assertions, `type: "QUOTATION"`):

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { getQuotationPrintData } from "./get-print-data";

let tenantId: string;
let quotationId: string;

describe("getQuotationPrintData", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Quotation Print Data Test Co", tradeNameEn: "Quotation Print Data Shop", vatNumber: "300000000000164" },
    });
    tenantId = tenant.id;
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId } }));

    const customer = await withTenant(tenantId, (tx) => tx.customer.create({ data: { tenantId, name: "Quotation Print Data Customer" } }));
    const quotation = await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: {
          tenantId,
          type: "QUOTATION",
          number: 1,
          customerId: customer.id,
          subtotal: 20,
          vatTotal: 3,
          grandTotal: 23,
        },
      })
    );
    quotationId = quotation.id;
  });

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("returns the document, tenant, and printFormat", async () => {
    const result = await getQuotationPrintData(tenantId, quotationId);
    expect(result).not.toBeNull();
    expect(result?.document.id).toBe(quotationId);
    expect(result?.tenant.id).toBe(tenantId);
    expect(result?.printFormat).toBe("THERMAL");
  });

  it("returns null for a nonexistent id", async () => {
    const result = await getQuotationPrintData(tenantId, "00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });

  it("returns null for a document that is a receipt, not a quotation", async () => {
    const customer = await withTenant(tenantId, (tx) => tx.customer.create({ data: { tenantId, name: "Wrong Type Customer" } }));
    const receipt = await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: { tenantId, type: "SALES_RECEIPT", number: 900, customerId: customer.id, subtotal: 1, vatTotal: 0.15, grandTotal: 1.15 },
      })
    );
    const result = await getQuotationPrintData(tenantId, receipt.id);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 6: Run the test**

Run: `set -a && source .env && set +a && npx vitest run src/lib/quotations/get-print-data.test.ts`
Expected: PASS

- [ ] **Step 7: Refactor the existing print pages and PDF routes to use the extracted helpers**

In `src/app/(app)/receipts/[id]/print/page.tsx`, replace the whole file with:

```tsx
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { getReceiptPrintData } from "@/lib/receipts/get-print-data";
import { ReceiptPrintThermal } from "@/components/receipts/receipt-print-thermal";
import { ReceiptPrintA4 } from "@/components/receipts/receipt-print-a4";

export default async function ReceiptPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const data = await getReceiptPrintData(tenantId, id);
  if (!data) {
    notFound();
  }

  if (data.printFormat === "A4") {
    return <ReceiptPrintA4 tenant={data.tenant} document={data.document} qrImageDataUrl={data.qrImageDataUrl} />;
  }
  return <ReceiptPrintThermal tenant={data.tenant} document={data.document} qrImageDataUrl={data.qrImageDataUrl} />;
}
```

In `src/app/(app)/quotations/[id]/print/page.tsx`, replace the whole file with:

```tsx
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { getQuotationPrintData } from "@/lib/quotations/get-print-data";
import { QuotationPrintThermal } from "@/components/quotations/quotation-print-thermal";
import { QuotationPrintA4 } from "@/components/quotations/quotation-print-a4";

export default async function QuotationPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const data = await getQuotationPrintData(tenantId, id);
  if (!data) {
    notFound();
  }

  if (data.printFormat === "A4") {
    return <QuotationPrintA4 tenant={data.tenant} document={data.document} />;
  }
  return <QuotationPrintThermal tenant={data.tenant} document={data.document} />;
}
```

In `src/app/api/receipts/[id]/pdf/route.tsx`, replace the whole file with:

```tsx
import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { auth } from "@/lib/auth/config";
import { getReceiptPrintData } from "@/lib/receipts/get-print-data";
import { ReceiptPdfDocument } from "@/lib/receipts/receipt-pdf";
import { ReceiptPdfA4Document } from "@/lib/receipts/receipt-pdf-a4";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const { id } = await params;

  const data = await getReceiptPrintData(tenantId, id);
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = await renderToBuffer(
    data.printFormat === "A4" ? (
      <ReceiptPdfA4Document tenant={data.tenant} document={data.document} qrImageDataUrl={data.qrImageDataUrl} />
    ) : (
      <ReceiptPdfDocument tenant={data.tenant} document={data.document} qrImageDataUrl={data.qrImageDataUrl} />
    )
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="receipt-${data.document.number}.pdf"`,
    },
  });
}
```

In `src/app/api/quotations/[id]/pdf/route.tsx`, replace the whole file with:

```tsx
import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { auth } from "@/lib/auth/config";
import { getQuotationPrintData } from "@/lib/quotations/get-print-data";
import { QuotationPdfDocument } from "@/lib/quotations/quotation-pdf";
import { QuotationPdfA4Document } from "@/lib/quotations/quotation-pdf-a4";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const { id } = await params;

  const data = await getQuotationPrintData(tenantId, id);
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = await renderToBuffer(
    data.printFormat === "A4" ? (
      <QuotationPdfA4Document tenant={data.tenant} document={data.document} />
    ) : (
      <QuotationPdfDocument tenant={data.tenant} document={data.document} />
    )
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="quotation-${data.document.number}.pdf"`,
    },
  });
}
```

This is a pure refactor — no existing test file asserts on these two page components (no component tests exist), and no test file exists yet for the PDF routes either (confirmed: no `pdf/route.test.ts` files exist for receipts or quotations), so there is nothing to update here beyond the files themselves.

- [ ] **Step 8: Write the new receipt print-data JSON endpoint**

Create `src/app/api/receipts/[id]/print-data/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { getReceiptPrintData } from "@/lib/receipts/get-print-data";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const { id } = await params;

  const data = await getReceiptPrintData(tenantId, id);
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
```

- [ ] **Step 9: Write tests for it**

Create `src/app/api/receipts/[id]/print-data/route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { GET } from "./route";

let tenantId: string;
let receiptId: string;
let otherTenantId: string;
let mockSession: { user: { tenantId: string; role: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

describe("/api/receipts/[id]/print-data", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Print Route Test Co", tradeNameEn: "Print Route Shop", vatNumber: "300000000000171" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId, role: "OWNER" } };
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId } }));

    const customer = await withTenant(tenantId, (tx) => tx.customer.create({ data: { tenantId, name: "Print Route Customer" } }));
    const receipt = await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: { tenantId, type: "SALES_RECEIPT", number: 1, customerId: customer.id, subtotal: 10, vatTotal: 1.5, grandTotal: 11.5, qrCode: "x" },
      })
    );
    receiptId = receipt.id;

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Other Print Route Co", tradeNameEn: "Other Print Route Shop", vatNumber: "300000000000188" },
    });
    otherTenantId = otherTenant.id;
  });

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  });

  it("returns the receipt's print data", async () => {
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: receiptId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.document.id).toBe(receiptId);
    expect(body.printFormat).toBe("THERMAL");
  });

  it("returns 404 for a document belonging to another tenant", async () => {
    mockSession = { user: { tenantId: otherTenantId, role: "OWNER" } };
    try {
      const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: receiptId }) });
      expect(response.status).toBe(404);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });

  it("returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: receiptId }) });
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });
});
```

- [ ] **Step 10: Run the test**

Run: `set -a && source .env && set +a && npx vitest run src/app/api/receipts/[id]/print-data/route.test.ts`
Expected: PASS

- [ ] **Step 11: Write the quotation print-data JSON endpoint and its tests**

Create `src/app/api/quotations/[id]/print-data/route.ts`, mirroring Step 8 exactly but importing `getQuotationPrintData` from `@/lib/quotations/get-print-data`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { getQuotationPrintData } from "@/lib/quotations/get-print-data";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const { id } = await params;

  const data = await getQuotationPrintData(tenantId, id);
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
```

Create `src/app/api/quotations/[id]/print-data/route.test.ts`, mirroring Step 9's test file exactly, but creating a `type: "QUOTATION"` document instead of a receipt, and importing from `./route` in the quotations path.

- [ ] **Step 12: Run the test**

Run: `set -a && source .env && set +a && npx vitest run src/app/api/quotations/[id]/print-data/route.test.ts`
Expected: PASS

- [ ] **Step 13: Run the full suite, typecheck, and lint**

Run: `set -a && source .env && set +a && npx vitest run && npx tsc --noEmit && npm run lint`
Expected: PASS

- [ ] **Step 14: Commit**

```bash
git add src/lib/receipts/get-print-data.ts src/lib/receipts/get-print-data.test.ts src/lib/quotations/get-print-data.ts src/lib/quotations/get-print-data.test.ts "src/app/api/receipts/[id]/print-data" "src/app/api/quotations/[id]/print-data" "src/app/(app)/receipts/[id]/print/page.tsx" "src/app/(app)/quotations/[id]/print/page.tsx" "src/app/api/receipts/[id]/pdf/route.tsx" "src/app/api/quotations/[id]/pdf/route.tsx"
git commit -m "Extract shared print-data assembly and add JSON print-data endpoints"
```

---

## Task 5: Consolidate print-scoping CSS and widen print component types

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/receipts/receipt-print-thermal.tsx`
- Modify: `src/components/receipts/receipt-print-a4.tsx`
- Modify: `src/components/quotations/quotation-print-thermal.tsx`
- Modify: `src/components/quotations/quotation-print-a4.tsx`
- Modify: `src/components/print-format/a4-print-parts.tsx`

**Interfaces:**
- Produces: each print component gains an optional `showPrintButton?: boolean` prop (default `true`, so every existing call site is unaffected) and its `document`/related prop types are widened to accept JSON-serialized values — consumed by Task 6's `PrintModal`, which passes `showPrintButton={false}` and JSON-fetched data.

This task has no new automated tests — it changes CSS and prop types with no new pure logic, and this project has no component-level test suite. Verification is the full existing suite staying green (nothing in it renders these components with a snapshot) plus Task 6's manual browser check once the modal actually uses them.

- [ ] **Step 1: Add the shared, robust print-scoping rule**

In `src/app/globals.css`, add to the end of the file (after the existing `@layer base { ... }` block):

```css

/* Print-scoping used by both the standalone print pages and the print modal
   (src/components/documents/print-modal.tsx): whatever carries id="print-target"
   is the only thing that prints, regardless of what else is on screen around it
   (app shell, dialog chrome, the page behind an open modal). Component-specific
   page-size rules (e.g. A4's @page block) stay local to those components --
   this rule only handles visibility, not page geometry. */
@media print {
  body * {
    visibility: hidden;
  }
  #print-target,
  #print-target * {
    visibility: visible;
  }
  #print-target {
    position: fixed;
    inset: 0;
  }
}
```

- [ ] **Step 2: Widen `ReceiptDocument`, remove the inline style block, add the id and the `showPrintButton` prop**

In `src/components/receipts/receipt-print-thermal.tsx`, change:

```tsx
import type { Customer, DocumentLine, Tenant, Document as PrismaDocument } from "@prisma/client";
import { PrintButton } from "./print-button";

function money(value: { toString(): string }): string {
  return Number(value.toString()).toFixed(2);
}

type ReceiptDocument = PrismaDocument & { customer: Customer; lines: DocumentLine[] };

export function ReceiptPrintThermal({
  tenant,
  document,
  qrImageDataUrl,
}: {
  tenant: Tenant;
  document: ReceiptDocument;
  qrImageDataUrl: string | null;
}) {
```

to:

```tsx
import type { Customer, Tenant, Document as PrismaDocument } from "@prisma/client";
import { PrintButton } from "./print-button";

function money(value: { toString(): string }): string {
  return Number(value.toString()).toFixed(2);
}

interface PrintableLine {
  id: string;
  productName: string;
  quantity: { toString(): string };
  unitPrice: { toString(): string };
  discount: { toString(): string };
  lineVat: { toString(): string };
  lineTotal: { toString(): string };
}

type ReceiptDocument = Omit<PrismaDocument, "subtotal" | "vatTotal" | "grandTotal"> & {
  subtotal: { toString(): string };
  vatTotal: { toString(): string };
  grandTotal: { toString(): string };
  customer: Customer;
  lines: PrintableLine[];
};

export function ReceiptPrintThermal({
  tenant,
  document,
  qrImageDataUrl,
  showPrintButton = true,
}: {
  tenant: Tenant;
  document: ReceiptDocument;
  qrImageDataUrl: string | null;
  showPrintButton?: boolean;
}) {
```

The widened `ReceiptDocument` still accepts everything the server-rendered print page passes (real Prisma `Decimal`s satisfy `{ toString(): string }` structurally, and `DocumentLine`'s other fields — `id`, `productName` — are already plain strings) — nothing changes for that existing call site. It additionally now accepts the plain-string values a JSON response produces, which is the point.

Change:

```tsx
    <div className="mx-auto max-w-[420px] bg-white p-6 text-sm text-black print:p-0 font-sans" dir="ltr">
```

to:

```tsx
    <div id="print-target" className="mx-auto max-w-[420px] bg-white p-6 text-sm text-black print:p-0 font-sans" dir="ltr">
```

Change:

```tsx
      <PrintButton />

      <style>{`
        @media print {
          aside,
          [aria-hidden] { display: none !important; }
          div.border-b.border-border-subtle.backdrop-blur-sm { display: none !important; }
          .flex.h-screen { display: block !important; height: auto !important; }
          .overflow-hidden.bg-bg-app { overflow: visible !important; }
          main { padding: 0 !important; overflow: visible !important; }
        }
      `}</style>
    </div>
  );
}
```

to:

```tsx
      {showPrintButton && <PrintButton />}
    </div>
  );
}
```

- [ ] **Step 3: Apply the identical treatment to `quotation-print-thermal.tsx`**

In `src/components/quotations/quotation-print-thermal.tsx`, apply the same four changes as Step 2, adjusted for the quotation type name:

Change:

```tsx
import type { Customer, DocumentLine, Tenant, Document as PrismaDocument } from "@prisma/client";
import { PrintButton } from "@/components/receipts/print-button";

function money(value: { toString(): string }): string {
  return Number(value.toString()).toFixed(2);
}

type QuotationDocument = PrismaDocument & { customer: Customer; lines: DocumentLine[] };

export function QuotationPrintThermal({
  tenant,
  document,
}: {
  tenant: Tenant;
  document: QuotationDocument;
}) {
```

to:

```tsx
import type { Customer, Tenant, Document as PrismaDocument } from "@prisma/client";
import { PrintButton } from "@/components/receipts/print-button";

function money(value: { toString(): string }): string {
  return Number(value.toString()).toFixed(2);
}

interface PrintableLine {
  id: string;
  productName: string;
  quantity: { toString(): string };
  unitPrice: { toString(): string };
  discount: { toString(): string };
  lineVat: { toString(): string };
  lineTotal: { toString(): string };
}

type QuotationDocument = Omit<PrismaDocument, "subtotal" | "vatTotal" | "grandTotal"> & {
  subtotal: { toString(): string };
  vatTotal: { toString(): string };
  grandTotal: { toString(): string };
  customer: Customer;
  lines: PrintableLine[];
};

export function QuotationPrintThermal({
  tenant,
  document,
  showPrintButton = true,
}: {
  tenant: Tenant;
  document: QuotationDocument;
  showPrintButton?: boolean;
}) {
```

Change the outer div to add `id="print-target"` (same as Step 2), and change the ending from:

```tsx
      <PrintButton />

      <style>{`
        @media print {
          aside,
          [aria-hidden] { display: none !important; }
          div.border-b.border-border-subtle.backdrop-blur-sm { display: none !important; }
          .flex.h-screen { display: block !important; height: auto !important; }
          .overflow-hidden.bg-bg-app { overflow: visible !important; }
          main { padding: 0 !important; overflow: visible !important; }
        }
      `}</style>
    </div>
  );
}
```

to:

```tsx
      {showPrintButton && <PrintButton />}
    </div>
  );
}
```

- [ ] **Step 4: Trim the A4 style block (keep the A4-specific rules), widen the document type, add the id and the prop**

In `src/components/receipts/receipt-print-a4.tsx`, change:

```tsx
import { Prata, Inter } from "next/font/google";
import type { Tenant } from "@prisma/client";
import { paginateA4Items } from "@/lib/print-format/paginate-a4-items";
import {
  A4BusinessHeader,
  A4BilledTo,
  A4ItemsTable,
  A4TotalsRow,
  A4Note,
  A4Footer,
  type A4Document,
} from "@/components/print-format/a4-print-parts";
import { PrintButton } from "./print-button";

const prata = Prata({ subsets: ["latin"], weight: "400" });
const inter = Inter({ subsets: ["latin"], weight: ["400", "600"] });

export function ReceiptPrintA4({
  tenant,
  document,
  qrImageDataUrl,
}: {
  tenant: Tenant;
  document: A4Document;
  qrImageDataUrl: string | null;
}) {
```

to:

```tsx
import { Prata, Inter } from "next/font/google";
import type { Tenant } from "@prisma/client";
import { paginateA4Items } from "@/lib/print-format/paginate-a4-items";
import {
  A4BusinessHeader,
  A4BilledTo,
  A4ItemsTable,
  A4TotalsRow,
  A4Note,
  A4Footer,
  type A4Document,
} from "@/components/print-format/a4-print-parts";
import { PrintButton } from "./print-button";

const prata = Prata({ subsets: ["latin"], weight: "400" });
const inter = Inter({ subsets: ["latin"], weight: ["400", "600"] });

export function ReceiptPrintA4({
  tenant,
  document,
  qrImageDataUrl,
  showPrintButton = true,
}: {
  tenant: Tenant;
  document: A4Document;
  qrImageDataUrl: string | null;
  showPrintButton?: boolean;
}) {
```

(`A4Document`'s own type widening happens once, in Step 6, since it's shared between the receipt and quotation A4 variants.)

Change:

```tsx
    <div className={`${inter.className} font-sans`} dir="ltr">
```

to:

```tsx
    <div id="print-target" className={`${inter.className} font-sans`} dir="ltr">
```

Change:

```tsx
      <PrintButton />

      <style>{`
        @media screen {
          .a4-page { margin-bottom: 24px; box-shadow: 0 4px 16px rgba(0,0,0,0.15); }
        }
        @media print {
          /* Without this, the browser's own default print margins (commonly
             ~12-25mm on all sides) stack on top of the page's own 18mm padding,
             shrinking the true printable area below what the page was designed
             for -- which is exactly what pushed the bottom of the page (the
             note/totals block) onto a second physical sheet even for short
             documents. Zeroing the browser margin makes our own padding the
             only margin, matching what the layout was actually measured against. */
          @page { size: A4; margin: 0; }
          aside,
          [aria-hidden] { display: none !important; }
          div.border-b.border-border-subtle.backdrop-blur-sm { display: none !important; }
          .flex.h-screen { display: block !important; height: auto !important; }
          .overflow-hidden.bg-bg-app { overflow: visible !important; }
          main { padding: 0 !important; overflow: visible !important; }
          .a4-page { box-shadow: none !important; margin-bottom: 0 !important; }
          .a4-page + .a4-page { break-before: page; }
        }
      `}</style>
    </div>
  );
}
```

to:

```tsx
      {showPrintButton && <PrintButton />}

      <style>{`
        @media screen {
          .a4-page { margin-bottom: 24px; box-shadow: 0 4px 16px rgba(0,0,0,0.15); }
        }
        @media print {
          /* Without this, the browser's own default print margins (commonly
             ~12-25mm on all sides) stack on top of the page's own 18mm padding,
             shrinking the true printable area below what the page was designed
             for -- which is exactly what pushed the bottom of the page (the
             note/totals block) onto a second physical sheet even for short
             documents. Zeroing the browser margin makes our own padding the
             only margin, matching what the layout was actually measured against. */
          @page { size: A4; margin: 0; }
          .a4-page { box-shadow: none !important; margin-bottom: 0 !important; }
          .a4-page + .a4-page { break-before: page; }
        }
      `}</style>
    </div>
  );
}
```

The `@page`/pagination rules stay local — they're A4-specific page-geometry concerns, not app-chrome-hiding, and applying `@page { size: A4 }` globally would incorrectly force A4 dimensions onto a thermal-format print job.

- [ ] **Step 5: Apply the identical A4 trim to `quotation-print-a4.tsx`**

In `src/components/quotations/quotation-print-a4.tsx`, apply the same three changes as Step 4 (add `showPrintButton` prop, add `id="print-target"` to the outer div, trim the style block to keep only the `@media screen`/`@page`/`.a4-page` rules and drop the `aside`/`[aria-hidden]`/`.flex.h-screen`/`.overflow-hidden.bg-bg-app`/`main` lines) — the file is otherwise structurally identical to `receipt-print-a4.tsx` (confirmed: both files have the exact same outer div, `PrintButton`, and style block).

- [ ] **Step 6: Widen `A4Document` and fix its date-agnostic header (shared by both receipt and quotation A4 variants)**

In `src/components/print-format/a4-print-parts.tsx`, change:

```tsx
import type { Customer, DocumentLine, Tenant, Document as PrismaDocument } from "@prisma/client";
import { truncateNote } from "@/lib/print-format/truncate-note";

export function money(value: { toString(): string }): string {
  return Number(value.toString()).toFixed(2);
}

export type A4Document = PrismaDocument & { customer: Customer; lines: DocumentLine[] };
```

to:

```tsx
import type { Customer, Tenant, Document as PrismaDocument } from "@prisma/client";
import { truncateNote } from "@/lib/print-format/truncate-note";

export function money(value: { toString(): string }): string {
  return Number(value.toString()).toFixed(2);
}

export interface A4PrintableLine {
  id: string;
  productName: string;
  quantity: { toString(): string };
  unitPrice: { toString(): string };
  discount: { toString(): string };
  lineVat: { toString(): string };
  lineTotal: { toString(): string };
}

export type A4Document = Omit<PrismaDocument, "subtotal" | "vatTotal" | "grandTotal"> & {
  subtotal: { toString(): string };
  vatTotal: { toString(): string };
  grandTotal: { toString(): string };
  customer: Customer;
  lines: A4PrintableLine[];
};
```

`document.createdAt` stays typed as a real `Date` (unchanged) — Task 6's `PrintModal` reconstructs a genuine `Date` object from the fetched ISO string before passing it down (see Task 6, Step 1), so every print component keeps using `document.createdAt.toISOString()` exactly as it already does today, in both contexts, with no changes to that logic anywhere in this task.

- [ ] **Step 7: Run typecheck, lint, and the full suite**

Run: `set -a && source .env && set +a && npx vitest run && npx tsc --noEmit && npm run lint`
Expected: PASS

- [ ] **Step 8: Manually verify the standalone print pages still work exactly as before**

Start the dev server. Create a receipt (New Receipt → Save, no print needed for this check), then navigate directly to `/receipts/<id>/print` — confirm it renders identically to before (sidebar/topbar hidden, print button visible on screen, printing produces the same output). Repeat for a quotation at `/quotations/<id>/print`. If `Settings.printFormat` is `THERMAL`, temporarily switch it to `A4` in Settings and re-check both, then switch back.

- [ ] **Step 9: Commit**

```bash
git add src/app/globals.css src/components/receipts/receipt-print-thermal.tsx src/components/receipts/receipt-print-a4.tsx src/components/quotations/quotation-print-thermal.tsx src/components/quotations/quotation-print-a4.tsx src/components/print-format/a4-print-parts.tsx
git commit -m "Consolidate print-scoping CSS into one shared rule and widen print component types"
```

---

## Task 6: The `PrintModal` component

**Files:**
- Create: `src/components/documents/print-modal.tsx`

**Interfaces:**
- Consumes: `getReceiptPrintData`/`getQuotationPrintData`'s response shape via the two new JSON endpoints (Task 4), the widened print components + `showPrintButton` prop (Task 5), `useToast()` (Task 1).
- Produces: `<PrintModal kind="receipt" | "quotation" documentId={string | null} onOpenChange={(open: boolean) => void} />` — consumed by Task 7 (New Receipt/Quotation) and Task 8 (History pages).

This task has no new automated tests (a client component with no pure logic to extract, consistent with this project's zero-component-tests convention). Verification is Task 7/8's manual browser checks, since this component only becomes reachable once something renders it.

- [ ] **Step 1: Write the component**

Create `src/components/documents/print-modal.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/language-provider";
import { useToast } from "@/lib/toast/toast-provider";
import { ReceiptPrintThermal } from "@/components/receipts/receipt-print-thermal";
import { ReceiptPrintA4 } from "@/components/receipts/receipt-print-a4";
import { QuotationPrintThermal } from "@/components/quotations/quotation-print-thermal";
import { QuotationPrintA4 } from "@/components/quotations/quotation-print-a4";

interface PrintDataLine {
  id: string;
  productName: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  lineVat: string;
  lineTotal: string;
}

interface PrintDataDocument {
  number: number;
  createdAt: string;
  subtotal: string;
  vatTotal: string;
  grandTotal: string;
  notes: string | null;
  customer: { name: string; vatId: string | null };
  lines: PrintDataLine[];
}

interface PrintData {
  printFormat: "THERMAL" | "A4";
  tenant: {
    tradeNameEn: string;
    tradeNameAr: string | null;
    legalName: string;
    vatNumber: string;
    crNumber: string | null;
    phone: string | null;
    address: string | null;
  };
  document: PrintDataDocument;
  qrImageDataUrl: string | null;
}

export function PrintModal({
  kind,
  documentId,
  onOpenChange,
}: {
  kind: "receipt" | "quotation";
  documentId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { dict } = useLocale();
  const { toast } = useToast();
  const [data, setData] = useState<PrintData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!documentId) {
      setData(null);
      return;
    }
    setLoading(true);
    fetch(`/api/${kind}s/${documentId}/print-data`)
      .then((response) => {
        if (!response.ok) throw new Error("failed to load print data");
        return response.json();
      })
      .then((body: PrintData) => setData(body))
      .catch(() => {
        toast.error(dict.common.somethingWentWrong);
        onOpenChange(false);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, documentId]);

  const open = documentId !== null;

  // A genuine Date instance, reconstructed once per fetch -- every print
  // component keeps calling `.toISOString()` on this exactly as it already
  // does for the server-rendered path, unchanged in Task 5.
  const documentForPrint = data
    ? {
        ...data.document,
        createdAt: new Date(data.document.createdAt),
      }
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        {loading || !data || !documentForPrint ? (
          <div className="flex items-center justify-center py-24">
            <Loader2Icon className="size-6 animate-spin text-muted-fg" />
          </div>
        ) : (
          <>
            {kind === "receipt" ? (
              data.printFormat === "A4" ? (
                <ReceiptPrintA4
                  tenant={data.tenant as never}
                  document={documentForPrint as never}
                  qrImageDataUrl={data.qrImageDataUrl}
                  showPrintButton={false}
                />
              ) : (
                <ReceiptPrintThermal
                  tenant={data.tenant as never}
                  document={documentForPrint as never}
                  qrImageDataUrl={data.qrImageDataUrl}
                  showPrintButton={false}
                />
              )
            ) : data.printFormat === "A4" ? (
              <QuotationPrintA4 tenant={data.tenant as never} document={documentForPrint as never} showPrintButton={false} />
            ) : (
              <QuotationPrintThermal tenant={data.tenant as never} document={documentForPrint as never} showPrintButton={false} />
            )}

            <DialogFooter>
              <Button variant="outline" asChild>
                <a href={`/api/${kind}s/${documentId}/pdf`}>{dict.common.download}</a>
              </Button>
              <Button variant="primary" onClick={() => window.print()}>
                {dict.printChrome.print}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

`tenant`/`document` are passed with an `as never` cast at this one boundary: the print components' prop types (Task 5) expect Prisma's real `Tenant` type structurally (all plain string/nullable-string fields, already compatible) and the widened `ReceiptDocument`/`QuotationDocument`/`A4Document` types (Task 5) — both are structurally satisfied by this component's locally-fetched shapes, but TypeScript can't always prove that across two independently-defined interfaces with different field orderings. This is the same category of cast this codebase already uses at trust boundaries elsewhere (e.g. `as Prisma.ProductUncheckedCreateInput` in the products API route) — narrow, at one clearly-marked spot, not sprinkled throughout.

- [ ] **Step 2: Run typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/documents/print-modal.tsx
git commit -m "Add the shared print-review modal"
```

---

## Task 7: Wire the modal into New Receipt and New Quotation

**Files:**
- Modify: `src/components/receipts/receipt-form.tsx`
- Modify: `src/components/quotations/quotation-form.tsx`

**Interfaces:**
- Consumes: `<PrintModal>` (Task 6).

- [ ] **Step 1: Receipt form — open the modal instead of navigating**

In `src/components/receipts/receipt-form.tsx`, remove the now-unused router import and add the modal import:

Change:

```tsx
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Customer } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductFormDialog } from "@/components/products/product-form-dialog";
```

to:

```tsx
import { useMemo, useState } from "react";
import type { Customer } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductFormDialog } from "@/components/products/product-form-dialog";
import { PrintModal } from "@/components/documents/print-modal";
```

Change:

```tsx
export function ReceiptForm({ initialCustomers, initialProducts, defaultVatRate }: ReceiptFormProps) {
  const router = useRouter();
  const { dict } = useLocale();
```

to:

```tsx
export function ReceiptForm({ initialCustomers, initialProducts, defaultVatRate }: ReceiptFormProps) {
  const { dict } = useLocale();
```

Add a new state variable alongside the existing `saving`/`error` state:

```tsx
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printModalId, setPrintModalId] = useState<string | null>(null);
```

Change the end of `handleSave`:

```tsx
      if (printAfter) {
        // Deliberately leave `saving` true through the navigation so the buttons stay
        // disabled until this component unmounts -- clearing it in a `finally` here
        // would re-enable Save & Print for the several seconds router.push takes to
        // actually navigate, letting a second click mint a second immutable receipt.
        router.push(`/receipts/${body.id}/print`);
      } else {
        resetForm();
        setSaving(false);
      }
    } catch {
      setError(dict.common.somethingWentWrong);
      setSaving(false);
    }
  }
```

to:

```tsx
      if (printAfter) {
        setPrintModalId(body.id);
        setSaving(false);
      } else {
        resetForm();
        setSaving(false);
      }
    } catch {
      setError(dict.common.somethingWentWrong);
      setSaving(false);
    }
  }
```

The double-submit concern the removed comment described no longer applies the same way: `printAfter`'s success path now sets `saving` back to `false` immediately (same as the non-print path), because a second click while the modal is open would just re-open the same modal for the same already-created receipt via `handleSave(true)` running again from scratch — which itself is guarded by the existing `disabled={saving}` only during the fetch, not the (now-instant) modal-open step. This matches the `printAfter: false` branch's existing behavior, which never had this concern.

Add the modal at the end of the JSX, right after the closing `</ProductFormDialog>`'s parent (before the outer `</div>`):

```tsx
      <ProductFormDialog
        open={quickCreateOpen}
        product={null}
        onOpenChange={setQuickCreateOpen}
        onSaved={handleQuickCreateSaved}
      />

      <PrintModal
        kind="receipt"
        documentId={printModalId}
        onOpenChange={(open) => {
          if (!open) {
            setPrintModalId(null);
            resetForm();
          }
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Apply the identical change to the quotation form**

In `src/components/quotations/quotation-form.tsx`, apply the same five changes as Step 1: drop the `useRouter` import, add the `PrintModal` import (`kind="quotation"`), drop the `const router = useRouter();` line, add `const [printModalId, setPrintModalId] = useState<string | null>(null);`, replace the `router.push(`/quotations/${body.id}/print`);` line with `setPrintModalId(body.id); setSaving(false);` (removing the same now-inapplicable comment), and add the `<PrintModal kind="quotation" .../>` block before the closing `</div>`.

- [ ] **Step 3: Run typecheck, lint, and the full suite**

Run: `set -a && source .env && set +a && npx vitest run && npx tsc --noEmit && npm run lint`
Expected: PASS. No existing test exercises `ReceiptForm`/`QuotationForm` directly (no component tests exist), so this confirms nothing else broke.

- [ ] **Step 4: Manually verify in the browser**

On `/receipts/new`: add a product line, fill in a customer, click "Save & Print" — confirm the receipt saves (check `/receipts` History afterward to confirm it's there) and a modal opens in place showing the receipt, with Print and Download buttons and a close (×) control, no page navigation. Click Print — confirm the browser's print dialog opens showing only the receipt content (not the sidebar, not the modal's own buttons). Close the print dialog, then close the modal — confirm the New Receipt form has reset and is ready for a new sale. Repeat the same walkthrough on `/quotations/new`.

- [ ] **Step 5: Commit**

```bash
git add src/components/receipts/receipt-form.tsx src/components/quotations/quotation-form.tsx
git commit -m "Open the print modal after Save & Print instead of navigating away"
```

---

## Task 8: Wire the modal into Receipt History and Quotation History

**Files:**
- Modify: `src/components/receipts/receipt-history-client.tsx`
- Modify: `src/components/quotations/quotation-history-client.tsx`

**Interfaces:**
- Consumes: `<PrintModal>` (Task 6).

- [ ] **Step 1: Receipt History — one action opens the modal instead of two separate links**

In `src/components/receipts/receipt-history-client.tsx`, change the import block:

```tsx
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
```

to:

```tsx
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PrintModal } from "@/components/documents/print-modal";
```

(`Link` is no longer used once the row action stops navigating — confirm no other `Link` usage remains in this file before removing the import; there is none, per the current file.)

Add a new state variable near the top of the component body, alongside `page`/`loading`/`error`:

```tsx
  const [printModalId, setPrintModalId] = useState<string | null>(null);
```

Change the row actions cell:

```tsx
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/receipts/${r.id}/print`}>{dict.common.view}</Link>
                        </Button>
                        <Button variant="outline" size="sm" asChild>
                          <a href={`/api/receipts/${r.id}/pdf`}>{dict.common.download}</a>
                        </Button>
                      </div>
                    </TableCell>
```

to:

```tsx
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setPrintModalId(r.id)}>
                        {dict.common.view}
                      </Button>
                    </TableCell>
```

Add the modal right before the component's closing `</div>`:

```tsx
      <PrintModal kind="receipt" documentId={printModalId} onOpenChange={(open) => !open && setPrintModalId(null)} />
    </div>
  );
}
```

- [ ] **Step 2: Apply the identical change to Quotation History**

In `src/components/quotations/quotation-history-client.tsx`, apply the same four changes as Step 1: drop the `Link` import, add the `PrintModal` import (`kind="quotation"`), add `printModalId` state, replace the two-button actions cell with the single `View` button calling `setPrintModalId(q.id)`, and add `<PrintModal kind="quotation" .../>` before the closing `</div>`.

- [ ] **Step 3: Run typecheck, lint, and the full suite**

Run: `set -a && source .env && set +a && npx vitest run && npx tsc --noEmit && npm run lint`
Expected: PASS

- [ ] **Step 4: Manually verify in the browser**

On `/receipts` (History), click the row action for an existing receipt — confirm the same modal opens (Print + Download + close), Download actually downloads the PDF (unchanged route, unchanged file), Print opens the browser print dialog scoped correctly, and closing the modal leaves you on the History page unchanged (no form to reset here, so no reset behavior to check). Repeat on `/quotations` (History).

- [ ] **Step 5: Commit**

```bash
git add src/components/receipts/receipt-history-client.tsx src/components/quotations/quotation-history-client.tsx
git commit -m "Open the print modal from Receipt/Quotation History instead of navigating"
```

---

## Final Verification

After all eight tasks are complete, run the full suite once more from a clean state (`set -a && source .env && set +a && npx vitest run && npx tsc --noEmit && npm run lint`) and repeat every manual browser check from Tasks 2, 3, 5, 7, and 8 end to end in one pass, before handing off to `finishing-a-development-branch`.
