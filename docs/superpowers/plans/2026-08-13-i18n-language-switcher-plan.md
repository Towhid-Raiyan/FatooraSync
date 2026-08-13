# Language Switcher (English/Arabic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a nav-based dropdown that lets each user personally switch the
entire on-screen app between English and Arabic (RTL-mirrored), independent
of what other staff at the same shop see, while the shop's Settings page
keeps controlling the default a first-time visitor sees.

**Architecture:** A cookie (`fs-locale`) resolved once server-side in the
root layout, feeding both `<html lang/dir>` (so first paint is already
correct) and a Client Component `LanguageProvider` Context. Two flat
TypeScript dictionaries (`en.ts`/`ar.ts`) hold every UI string; Server
Components read the resolved locale + dictionary directly, Client
Components use a `useLocale()` hook. No translation library, no
locale-prefixed routes.

**Tech Stack:** Next.js 15 App Router (Server + Client Components), plain
TypeScript objects for translations (no next-intl/i18next), Prisma
migration for the `Settings.language` column default, Vitest for unit
tests.

## Global Constraints

- English dictionary values (`src/lib/i18n/dictionaries/en.ts`) must match
  the current hardcoded UI text **verbatim** — this is a text-source swap,
  not a copy rewrite. No existing behavior or wording should change for
  English users.
- Printed receipt/quotation documents (`a4-print-parts.tsx`,
  `receipt-print-a4.tsx`, `quotation-print-a4.tsx`,
  `receipt-print-thermal.tsx`, `quotation-print-thermal.tsx`) are **out of
  scope** — do not touch their text or add dictionary lookups inside them.
  Only the print *page's* surrounding chrome (`print-button.tsx`) is in
  scope.
- Product/customer data (names, addresses, notes typed in by the shop) is
  never translated — only the app's own static labels/buttons/placeholders.
- Numeric/money table columns (`text-right` on Qty/Price/VAT/Total/Actions
  columns) stay right-aligned in both languages — do not convert these to
  `text-end`. This was an explicit decision, not an oversight.
- Every other directional Tailwind class (`ml-`/`mr-`/`pl-`/`pr-`/`left-`/
  `right-`) that is genuinely about layout direction (not numeric-column
  alignment) must become its logical equivalent (`ms-`/`me-`/`ps-`/`pe-`/
  `start-`/`end-`) so it flips automatically under `dir="rtl"`.
- No numeral localization — prices/quantities/dates keep regular digits
  (0,1,2…) in both languages.
- `Settings.language`'s stored value for **existing** tenant rows (e.g. the
  demo tenant, currently `"ar"`) must not be changed by the schema-default
  migration — only the column default for newly-created rows changes.
- Every dictionary key added to `en.ts` must have a matching key (same
  nested shape) in `ar.ts`. Task 1's parity test enforces this for all
  future edits too.

---

### Task 1: i18n foundation — locale resolution, dictionaries, provider, root layout

**Files:**
- Create: `src/lib/i18n/locale.ts`
- Create: `src/lib/i18n/locale.test.ts`
- Create: `src/lib/i18n/dictionaries/en.ts`
- Create: `src/lib/i18n/dictionaries/ar.ts`
- Create: `src/lib/i18n/dictionaries/dictionary.types.ts`
- Create: `src/lib/i18n/dictionaries/dictionary-parity.test.ts`
- Create: `src/lib/i18n/get-dictionary.ts`
- Create: `src/lib/i18n/language-provider.tsx`
- Modify: `prisma/schema.prisma`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Produces: `type Locale = "en" | "ar"` (`src/lib/i18n/locale.ts`)
- Produces: `LOCALE_COOKIE = "fs-locale"` (`src/lib/i18n/locale.ts`)
- Produces: `pickLocale(cookieValue: string | null | undefined, tenantDefault: string | null | undefined): Locale` (`src/lib/i18n/locale.ts`) — pure, unit-tested
- Produces: `resolveLocale(): Promise<Locale>` (`src/lib/i18n/locale.ts`) — server-only, reads the cookie + session + tenant Settings
- Produces: `type Dictionary` (`src/lib/i18n/dictionaries/dictionary.types.ts`)
- Produces: `getDictionary(locale: Locale): Dictionary` (`src/lib/i18n/get-dictionary.ts`)
- Produces: `LanguageProvider({ initialLocale, children })` and `useLocale(): { locale: Locale; dict: Dictionary; setLocale: (l: Locale) => void }` (`src/lib/i18n/language-provider.tsx`)

- [ ] **Step 1: Write the dictionary type shape**

Create `src/lib/i18n/dictionaries/dictionary.types.ts`:

```ts
export interface Dictionary {
  nav: {
    home: string;
    newReceipt: string;
    newQuotation: string;
    products: string;
    customers: string;
    receiptHistory: string;
    quotationHistory: string;
    settings: string;
  };
  common: {
    save: string;
    savingEllipsis: string;
    edit: string;
    deactivate: string;
    reactivate: string;
    actions: string;
    showInactive: string;
    somethingWentWrong: string;
    addProduct: string;
    view: string;
    download: string;
    previous: string;
    next: string;
    loading: string;
    to: string;
    poweredBy: string;
    pageOf: (page: number, totalPages: number) => string;
    totalMatches: (count: number) => string;
  };
  home: {
    welcomeBack: string;
    products: string;
    customers: string;
  };
  login: {
    title: string;
    subtitle: string;
    email: string;
    emailPlaceholder: string;
    password: string;
    invalidCredentials: string;
    signIn: string;
  };
  settings: {
    title: string;
    defaultVatRate: string;
    language: string;
    languageCaption: string;
    businessPhone: string;
    printFormat: string;
    thermal: string;
    a4: string;
    saveChanges: string;
  };
  products: {
    searchPlaceholder: string;
    noProductsYet: string;
    sku: string;
    barcode: string;
    name: string;
    unit: string;
    unitPrice: string;
    vat: string;
    quantity: string;
    defaultBadge: string;
    dialogTitleEdit: string;
    dialogTitleAdd: string;
    nameEn: string;
    nameAr: string;
    useDefaultVat: string;
    vatRate: string;
    units: { piece: string; kg: string; box: string; carton: string; liter: string };
  };
  customers: {
    searchPlaceholder: string;
    noCustomersYet: string;
    name: string;
    vatId: string;
    crNumber: string;
    phone: string;
    address: string;
    systemBadge: string;
    dialogTitleEdit: string;
    dialogTitleAdd: string;
  };
  documentForm: {
    customerSection: {
      title: string;
      name: string;
      vatId: string;
      crNumber: string;
      phone: string;
      address: string;
    };
    itemsSection: {
      title: string;
      searchPlaceholder: string;
      noMatches: string;
      exceedsStock: string;
      exceedsSubtotal: string;
      headers: {
        number: string;
        sku: string;
        product: string;
        unit: string;
        qty: string;
        price: string;
        disc: string;
        vat: string;
        total: string;
        actions: string;
      };
    };
    notesTitle: string;
    totals: {
      title: string;
      subtotal: string;
      totalVat: string;
      grandTotal: string;
      savePrint: string;
      addAtLeastOneItem: string;
    };
  };
  receiptHistory: {
    searchPlaceholder: string;
    noMatching: string;
    noneYet: string;
    number: string;
    customer: string;
    date: string;
    total: string;
    loadError: string;
  };
  quotationHistory: {
    searchPlaceholder: string;
    noMatching: string;
    noneYet: string;
    number: string;
    customer: string;
    date: string;
    total: string;
    loadError: string;
  };
  printChrome: {
    print: string;
  };
}
```

- [ ] **Step 2: Write the English dictionary**

Create `src/lib/i18n/dictionaries/en.ts`. Every value here is copied
verbatim from the current hardcoded UI text (Global Constraints):

```ts
import type { Dictionary } from "./dictionary.types";

export const en: Dictionary = {
  nav: {
    home: "Home",
    newReceipt: "New Receipt",
    newQuotation: "New Quotation",
    products: "Products",
    customers: "Customers",
    receiptHistory: "Receipt History",
    quotationHistory: "Quotation History",
    settings: "Settings",
  },
  common: {
    save: "Save",
    savingEllipsis: "Saving…",
    edit: "Edit",
    deactivate: "Deactivate",
    reactivate: "Reactivate",
    actions: "Actions",
    showInactive: "Show inactive",
    somethingWentWrong: "Something went wrong",
    addProduct: "+ Add Product",
    view: "View",
    download: "Download",
    previous: "← Previous",
    next: "Next →",
    loading: "Loading…",
    to: "to",
    poweredBy: "Powered by FatooraSync",
    pageOf: (page, totalPages) => `Page ${page} of ${totalPages}`,
    totalMatches: (count) => `${count} total match${count === 1 ? "" : "es"}`,
  },
  home: {
    welcomeBack: "Welcome back",
    products: "Products",
    customers: "Customers",
  },
  login: {
    title: "Welcome back",
    subtitle: "Sign in to your business account",
    email: "Email",
    emailPlaceholder: "owner@yourbusiness.com",
    password: "Password",
    invalidCredentials: "Invalid email or password",
    signIn: "Sign In",
  },
  settings: {
    title: "Settings",
    defaultVatRate: "Default VAT Rate (%)",
    language: "Language",
    languageCaption: "The language new visitors to this shop see by default. Your own choice from the nav bar overrides this on your device.",
    businessPhone: "Business Phone",
    printFormat: "Print Format",
    thermal: "Thermal (receipt roll)",
    a4: "A4 (full page)",
    saveChanges: "Save Changes",
  },
  products: {
    searchPlaceholder: "Search by name, SKU, or barcode",
    noProductsYet: "No products yet — add your first one",
    sku: "SKU",
    barcode: "Barcode",
    name: "Name",
    unit: "Unit",
    unitPrice: "Unit Price",
    vat: "VAT",
    quantity: "Quantity",
    defaultBadge: "Default",
    dialogTitleEdit: "Edit Product",
    dialogTitleAdd: "Add Product",
    nameEn: "Name (English)",
    nameAr: "Name (Arabic)",
    useDefaultVat: "Use default VAT rate",
    vatRate: "VAT Rate (%)",
    units: { piece: "Piece", kg: "KG", box: "Box", carton: "Carton", liter: "Liter" },
  },
  customers: {
    searchPlaceholder: "Search by name, VAT ID, or phone",
    noCustomersYet: "No customers yet — add your first one",
    name: "Name",
    vatId: "VAT ID",
    crNumber: "CR Number",
    phone: "Phone",
    address: "Address",
    systemBadge: "System",
    dialogTitleEdit: "Edit Customer",
    dialogTitleAdd: "Add Customer",
  },
  documentForm: {
    customerSection: {
      title: "Customer",
      name: "Name",
      vatId: "VAT ID",
      crNumber: "CR Number",
      phone: "Phone",
      address: "Address",
    },
    itemsSection: {
      title: "Items",
      searchPlaceholder: "Scan barcode or search by SKU / name",
      noMatches: "No matches",
      exceedsStock: "exceeds stock",
      exceedsSubtotal: "exceeds item subtotal",
      headers: {
        number: "#",
        sku: "SKU",
        product: "Product",
        unit: "Unit",
        qty: "Qty",
        price: "Price",
        disc: "Disc.",
        vat: "VAT",
        total: "Total",
        actions: "Actions",
      },
    },
    notesTitle: "Notes",
    totals: {
      title: "Totals",
      subtotal: "Subtotal",
      totalVat: "Total VAT",
      grandTotal: "Grand Total",
      savePrint: "Save & Print",
      addAtLeastOneItem: "Add at least one item",
    },
  },
  receiptHistory: {
    searchPlaceholder: "Receipt #, customer name, or VAT ID",
    noMatching: "No matching receipts",
    noneYet: "No receipts yet — create your first one",
    number: "Receipt #",
    customer: "Customer",
    date: "Date",
    total: "Total",
    loadError: "Something went wrong loading receipts",
  },
  quotationHistory: {
    searchPlaceholder: "Quotation #, customer name, or VAT ID",
    noMatching: "No matching quotations",
    noneYet: "No quotations yet — create your first one",
    number: "Quotation #",
    customer: "Customer",
    date: "Date",
    total: "Total",
    loadError: "Something went wrong loading quotations",
  },
  printChrome: {
    print: "Print",
  },
};
```

- [ ] **Step 3: Write the Arabic dictionary**

Create `src/lib/i18n/dictionaries/ar.ts`. Same key shape as `en.ts`,
exactly (the parity test in Step 4 enforces this going forward):

```ts
import type { Dictionary } from "./dictionary.types";

export const ar: Dictionary = {
  nav: {
    home: "الرئيسية",
    newReceipt: "فاتورة جديدة",
    newQuotation: "عرض سعر جديد",
    products: "المنتجات",
    customers: "العملاء",
    receiptHistory: "سجل الفواتير",
    quotationHistory: "سجل عروض الأسعار",
    settings: "الإعدادات",
  },
  common: {
    save: "حفظ",
    savingEllipsis: "جارٍ الحفظ…",
    edit: "تعديل",
    deactivate: "إيقاف",
    reactivate: "تفعيل",
    actions: "إجراءات",
    showInactive: "إظهار الموقوفين",
    somethingWentWrong: "حدث خطأ ما",
    addProduct: "+ إضافة منتج",
    view: "عرض",
    download: "تنزيل",
    previous: "→ السابق",
    next: "التالي ←",
    loading: "جارٍ التحميل…",
    to: "إلى",
    poweredBy: "بدعم من FatooraSync",
    pageOf: (page, totalPages) => `صفحة ${page} من ${totalPages}`,
    totalMatches: (count) => (count === 1 ? "نتيجة واحدة" : `${count} نتيجة إجمالاً`),
  },
  home: {
    welcomeBack: "مرحباً بعودتك",
    products: "المنتجات",
    customers: "العملاء",
  },
  login: {
    title: "مرحباً بعودتك",
    subtitle: "سجّل الدخول إلى حساب متجرك",
    email: "البريد الإلكتروني",
    emailPlaceholder: "owner@yourbusiness.com",
    password: "كلمة المرور",
    invalidCredentials: "البريد الإلكتروني أو كلمة المرور غير صحيحة",
    signIn: "تسجيل الدخول",
  },
  settings: {
    title: "الإعدادات",
    defaultVatRate: "نسبة ضريبة القيمة المضافة الافتراضية (%)",
    language: "اللغة",
    languageCaption: "اللغة التي يراها الزائر لأول مرة في هذا المتجر افتراضياً. اختيارك الشخصي من شريط التنقل يتجاوز هذا الإعداد على جهازك.",
    businessPhone: "هاتف المتجر",
    printFormat: "تنسيق الطباعة",
    thermal: "حراري (لفة إيصالات)",
    a4: "A4 (صفحة كاملة)",
    saveChanges: "حفظ التغييرات",
  },
  products: {
    searchPlaceholder: "ابحث بالاسم أو رمز المنتج أو الباركود",
    noProductsYet: "لا توجد منتجات بعد — أضف منتجك الأول",
    sku: "رمز المنتج",
    barcode: "الباركود",
    name: "الاسم",
    unit: "الوحدة",
    unitPrice: "سعر الوحدة",
    vat: "ضريبة القيمة المضافة",
    quantity: "الكمية",
    defaultBadge: "افتراضي",
    dialogTitleEdit: "تعديل المنتج",
    dialogTitleAdd: "إضافة منتج",
    nameEn: "الاسم (إنجليزي)",
    nameAr: "الاسم (عربي)",
    useDefaultVat: "استخدام نسبة الضريبة الافتراضية",
    vatRate: "نسبة الضريبة (%)",
    units: { piece: "قطعة", kg: "كيلوغرام", box: "صندوق", carton: "كرتون", liter: "لتر" },
  },
  customers: {
    searchPlaceholder: "ابحث بالاسم أو الرقم الضريبي أو الهاتف",
    noCustomersYet: "لا يوجد عملاء بعد — أضف عميلك الأول",
    name: "الاسم",
    vatId: "الرقم الضريبي",
    crNumber: "رقم السجل التجاري",
    phone: "الهاتف",
    address: "العنوان",
    systemBadge: "نظامي",
    dialogTitleEdit: "تعديل العميل",
    dialogTitleAdd: "إضافة عميل",
  },
  documentForm: {
    customerSection: {
      title: "العميل",
      name: "الاسم",
      vatId: "الرقم الضريبي",
      crNumber: "رقم السجل التجاري",
      phone: "الهاتف",
      address: "العنوان",
    },
    itemsSection: {
      title: "الأصناف",
      searchPlaceholder: "امسح الباركود أو ابحث برمز المنتج / الاسم",
      noMatches: "لا توجد نتائج",
      exceedsStock: "يتجاوز المخزون",
      exceedsSubtotal: "يتجاوز إجمالي الصنف",
      headers: {
        number: "#",
        sku: "رمز المنتج",
        product: "المنتج",
        unit: "الوحدة",
        qty: "الكمية",
        price: "السعر",
        disc: "الخصم",
        vat: "الضريبة",
        total: "الإجمالي",
        actions: "إجراءات",
      },
    },
    notesTitle: "ملاحظات",
    totals: {
      title: "الإجماليات",
      subtotal: "الإجمالي الفرعي",
      totalVat: "إجمالي ضريبة القيمة المضافة",
      grandTotal: "الإجمالي الكلي",
      savePrint: "حفظ وطباعة",
      addAtLeastOneItem: "أضف صنفاً واحداً على الأقل",
    },
  },
  receiptHistory: {
    searchPlaceholder: "رقم الفاتورة أو اسم العميل أو الرقم الضريبي",
    noMatching: "لا توجد فواتير مطابقة",
    noneYet: "لا توجد فواتير بعد — أنشئ أول فاتورة",
    number: "رقم الفاتورة",
    customer: "العميل",
    date: "التاريخ",
    total: "الإجمالي",
    loadError: "حدث خطأ أثناء تحميل الفواتير",
  },
  quotationHistory: {
    searchPlaceholder: "رقم عرض السعر أو اسم العميل أو الرقم الضريبي",
    noMatching: "لا توجد عروض أسعار مطابقة",
    noneYet: "لا توجد عروض أسعار بعد — أنشئ أول عرض",
    number: "رقم العرض",
    customer: "العميل",
    date: "التاريخ",
    total: "الإجمالي",
    loadError: "حدث خطأ أثناء تحميل عروض الأسعار",
  },
  printChrome: {
    print: "طباعة",
  },
};
```

- [ ] **Step 4: Write the dictionary parity test**

Create `src/lib/i18n/dictionaries/dictionary-parity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { en } from "./en";
import { ar } from "./ar";

function collectKeyPaths(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null || typeof obj === "function") {
    return [prefix];
  }
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "function") return [path];
    if (typeof value === "object" && value !== null) return collectKeyPaths(value, path);
    return [path];
  });
}

describe("dictionary parity", () => {
  it("en and ar expose exactly the same key paths", () => {
    const enKeys = collectKeyPaths(en).sort();
    const arKeys = collectKeyPaths(ar).sort();
    expect(arKeys).toEqual(enKeys);
  });

  it("no dictionary value is an empty string", () => {
    for (const [dictName, dict] of [["en", en], ["ar", ar]] as const) {
      for (const path of collectKeyPaths(dict)) {
        const value = path.split(".").reduce<unknown>((acc, key) => (acc as Record<string, unknown>)[key], dict);
        if (typeof value === "string") {
          expect(value.length, `${dictName}.${path} should not be empty`).toBeGreaterThan(0);
        }
      }
    }
  });
});
```

- [ ] **Step 5: Run the dictionary tests**

Run: `set -a && source .env && set +a && npx vitest run src/lib/i18n/dictionaries/dictionary-parity.test.ts`
Expected: 2 tests pass.

- [ ] **Step 6: Write `get-dictionary.ts`**

Create `src/lib/i18n/get-dictionary.ts`:

```ts
import type { Locale } from "./locale";
import type { Dictionary } from "./dictionaries/dictionary.types";
import { en } from "./dictionaries/en";
import { ar } from "./dictionaries/ar";

const DICTIONARIES: Record<Locale, Dictionary> = { en, ar };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}
```

- [ ] **Step 7: Write the failing test for `pickLocale`**

Create `src/lib/i18n/locale.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pickLocale } from "./locale";

describe("pickLocale", () => {
  it("uses the cookie value when it's a valid locale", () => {
    expect(pickLocale("ar", "en")).toBe("ar");
    expect(pickLocale("en", "ar")).toBe("en");
  });

  it("falls back to the tenant default when there's no cookie", () => {
    expect(pickLocale(undefined, "ar")).toBe("ar");
    expect(pickLocale(null, "en")).toBe("en");
  });

  it("falls back to English when neither the cookie nor a tenant default is valid", () => {
    expect(pickLocale(undefined, undefined)).toBe("en");
    expect(pickLocale(null, null)).toBe("en");
  });

  it("ignores an invalid cookie value and falls through to the tenant default", () => {
    expect(pickLocale("fr", "ar")).toBe("ar");
  });

  it("ignores an invalid tenant default and falls through to English", () => {
    expect(pickLocale(undefined, "fr")).toBe("en");
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `set -a && source .env && set +a && npx vitest run src/lib/i18n/locale.test.ts`
Expected: FAIL — `pickLocale` is not exported from `./locale` (the file doesn't exist yet).

- [ ] **Step 9: Write `locale.ts`**

Create `src/lib/i18n/locale.ts`:

```ts
import { cookies } from "next/headers";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";

export type Locale = "en" | "ar";

export const LOCALE_COOKIE = "fs-locale";

function isLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "ar";
}

// Pure decision logic, kept separate from the cookies()/session/Prisma I/O
// below so it's directly unit-testable without a request context -- same
// split this codebase already uses elsewhere (e.g. calculate-totals.ts vs.
// the route handlers that call it).
export function pickLocale(
  cookieValue: string | null | undefined,
  tenantDefault: string | null | undefined
): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  if (isLocale(tenantDefault)) return tenantDefault;
  return "en";
}

// Resolution order: the visitor's own cookie, then (if logged in) their
// tenant's Settings.language shop default, then English.
export async function resolveLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieValue)) return cookieValue;

  const session = await auth();
  if (!session?.user?.tenantId) return "en";

  const settings = await prisma.settings.findUnique({
    where: { tenantId: session.user.tenantId },
    select: { language: true },
  });
  return pickLocale(cookieValue, settings?.language);
}
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `set -a && source .env && set +a && npx vitest run src/lib/i18n/locale.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 11: Write the Language Context provider**

Create `src/lib/i18n/language-provider.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, type Locale } from "./locale";
import { getDictionary } from "./get-dictionary";
import type { Dictionary } from "./dictionaries/dictionary.types";

interface LanguageContextValue {
  locale: Locale;
  dict: Dictionary;
  setLocale: (locale: Locale) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback(
    (next: Locale) => {
      // 1 year, matches this being a durable personal preference rather
      // than a session-scoped value.
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; SameSite=Lax`;
      setLocaleState(next);
      // Server Components on the current page (nav labels rendered
      // server-side, page titles, etc.) only see the new cookie after a
      // refresh -- Client Components update immediately via the state
      // change above.
      router.refresh();
    },
    [router]
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ locale, dict: getDictionary(locale), setLocale }),
    [locale, setLocale]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLocale(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLocale must be used within a LanguageProvider");
  return ctx;
}
```

- [ ] **Step 12: Add the Prisma migration for the `Settings.language` default**

Modify `prisma/schema.prisma` — change:

```prisma
  language       String      @default("ar")
```

to:

```prisma
  language       String      @default("en")
```

Run: `npx prisma migrate dev --name settings_language_default_en`
Expected: a new migration directory under `prisma/migrations/` containing
`ALTER TABLE "Settings" ALTER COLUMN "language" SET DEFAULT 'en';` — this
only changes the column default for future inserts; it does not touch any
existing row (Global Constraints).

- [ ] **Step 13: Wire locale resolution into the root layout**

Read `src/app/layout.tsx` first to confirm it's still exactly the file
already on `main` (font setup, `<html lang="en">`, metadata) before
editing — this step replaces the whole file.

Modify `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Plus_Jakarta_Sans, IBM_Plex_Sans_Arabic } from "next/font/google";
import { resolveLocale } from "@/lib/i18n/locale";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["400", "500", "600", "700", "800"],
});

const ibmPlexSansArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  variable: "--font-ibm-plex-arabic",
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "FatooraSync",
  description: "Cloud POS and business management for Saudi SMEs",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await resolveLocale();
  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir}>
      <body
        className={`${plusJakartaSans.variable} ${ibmPlexSansArabic.variable} ${
          locale === "ar" ? "font-arabic" : "font-sans"
        } antialiased`}
      >
        <LanguageProvider initialLocale={locale}>{children}</LanguageProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 14: Confirm the `font-arabic` utility already exists**

`src/app/globals.css`'s `@theme inline` block already defines both
`--font-sans: var(--font-jakarta), sans-serif;` and
`--font-arabic: var(--font-ibm-plex-arabic), sans-serif;` (lines 60-61) —
Tailwind v4 auto-generates a `font-arabic` utility class from that token,
so the conditional `className` in Step 13 works with no CSS changes
needed. Nothing to do here beyond confirming those two lines are still
present.

- [ ] **Step 15: Verify the whole app still boots**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `set -a && source .env && set +a && npx vitest run src/lib/i18n`
Expected: all i18n tests pass (7 tests: 5 `pickLocale` + 2 dictionary parity).

- [ ] **Step 16: Commit**

```bash
git add src/lib/i18n prisma/schema.prisma prisma/migrations src/app/layout.tsx
git commit -m "Add i18n foundation: locale resolution, dictionaries, language provider"
```

---

### Task 2: Nav dropdown, Sidebar/Topbar translation, shared-primitive RTL fixes

**Files:**
- Create: `src/components/shell/language-switcher.tsx`
- Modify: `src/components/shell/nav-items.ts`
- Modify: `src/components/shell/sidebar.tsx`
- Modify: `src/components/shell/topbar.tsx`
- Modify: `src/components/ui/button.tsx`
- Modify: `src/components/ui/badge.tsx`
- Modify: `src/components/ui/dialog.tsx`
- Modify: `src/components/ui/table.tsx`

**Interfaces:**
- Consumes: `useLocale()` from `src/lib/i18n/language-provider.tsx` (Task 1)
- Consumes: `Dictionary["nav"]` shape (Task 1)

- [ ] **Step 1: Restructure `nav-items.ts` to carry a dictionary key instead of a literal label**

Modify `src/components/shell/nav-items.ts`:

```ts
import type { Dictionary } from "@/lib/i18n/dictionaries/dictionary.types";

export interface NavItem {
  labelKey: keyof Dictionary["nav"];
  href: string | null; // null = visually present but not yet clickable ("coming soon")
}

export const NAV_ITEMS: NavItem[] = [
  { labelKey: "home", href: "/" },
  { labelKey: "newReceipt", href: "/receipts/new" },
  { labelKey: "newQuotation", href: "/quotations/new" },
  { labelKey: "products", href: "/products" },
  { labelKey: "customers", href: "/customers" },
  { labelKey: "receiptHistory", href: "/receipts" },
  { labelKey: "quotationHistory", href: "/quotations" },
  { labelKey: "settings", href: "/settings" },
];
```

- [ ] **Step 2: Update Sidebar to render translated labels**

Modify `src/components/shell/sidebar.tsx` — add the `useLocale` import and
replace every `item.label` with `dict.nav[item.labelKey]`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/lib/i18n/language-provider";
import { NAV_ITEMS } from "./nav-items";

export function Sidebar({ tenantName }: { tenantName: string }) {
  const pathname = usePathname();
  const { dict } = useLocale();

  return (
    <aside className="flex w-[220px] shrink-0 flex-col bg-gradient-to-b from-primary-mid to-primary-dark py-5 text-white">
      <div className="mb-3 flex items-center gap-2 border-b border-white/10 px-5 pb-4 font-bold">
        <span className="h-[9px] w-[9px] rounded-full bg-accent-mint" />
        FatooraSync
      </div>

      <nav className="flex flex-col">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href !== null && pathname === item.href;
          const label = dict.nav[item.labelKey];

          if (item.href === null) {
            return (
              <div
                key={item.labelKey}
                className="cursor-not-allowed border-s-[3px] border-transparent px-5 py-2.5 text-sm text-white/35"
                title="Coming soon"
              >
                {label}
              </div>
            );
          }

          return (
            <Link
              key={item.labelKey}
              href={item.href}
              className={`border-s-[3px] px-5 py-2.5 text-sm transition-colors ${
                isActive
                  ? "border-accent-mint bg-white/10 font-semibold text-white"
                  : "border-transparent text-white/75 hover:bg-white/5 hover:text-white"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex items-center gap-2.5 border-t border-white/10 px-5 pt-3.5 text-[12.5px] text-white/70">
        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-accent-mint text-[11px] font-bold text-primary-dark">
          {tenantName.slice(0, 2).toUpperCase()}
        </span>
        {tenantName}
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Write the language switcher dropdown**

Create `src/components/shell/language-switcher.tsx`:

```tsx
"use client";

import { useLocale } from "@/lib/i18n/language-provider";
import type { Locale } from "@/lib/i18n/locale";

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();

  return (
    <select
      aria-label="Language"
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
    >
      <option value="en">English</option>
      <option value="ar">العربية</option>
    </select>
  );
}
```

- [ ] **Step 4: Wire the switcher and translated title into Topbar**

Modify `src/components/shell/topbar.tsx`:

```tsx
"use client";

import { usePathname } from "next/navigation";
import { useLocale } from "@/lib/i18n/language-provider";
import { LanguageSwitcher } from "./language-switcher";
import { NAV_ITEMS } from "./nav-items";

export function Topbar({ userEmail }: { userEmail: string }) {
  const pathname = usePathname();
  const { dict } = useLocale();
  const activeItem = NAV_ITEMS.find((item) => item.href === pathname);
  const title = activeItem ? dict.nav[activeItem.labelKey] : "FatooraSync";

  return (
    <div className="relative z-10 flex items-center justify-between border-b border-border-subtle bg-white/70 px-7 py-3.5 backdrop-blur-sm">
      <div className="text-[15px] font-bold text-heading">{title}</div>
      <div className="flex items-center gap-3">
        <LanguageSwitcher />
        <div className="text-[12.5px] text-muted-fg">{userEmail}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Fix RTL physical properties in `button.tsx`**

Modify `src/components/ui/button.tsx` — in the `size` variants object,
replace each `pr-`/`pl-` pair with `pe-`/`ps-`:

```
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2",
```

- [ ] **Step 6: Fix RTL physical properties in `badge.tsx`**

Modify `src/components/ui/badge.tsx` — in `badgeVariants`, change
`has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5` to
`has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5`.

- [ ] **Step 7: Fix the dialog close button position**

Modify `src/components/ui/dialog.tsx` — change
`className="absolute top-2 right-2"` (the `DialogPrimitive.Close` button)
to `className="absolute top-2 end-2"`. Leave the `DialogPrimitive.Content`
centering classes (`top-1/2 left-1/2 ... -translate-x-1/2 -translate-y-1/2`)
unchanged — centering math at exactly 50% is direction-independent, so
there's nothing to flip there.

- [ ] **Step 8: Fix RTL physical properties in `table.tsx`**

Modify `src/components/ui/table.tsx`:
- In the `TableHead` className, change `text-left` to `text-start` and
  `[&:has([role=checkbox])]:pr-0` to `[&:has([role=checkbox])]:pe-0`.
- In the `TableCell` className, change `[&:has([role=checkbox])]:pr-0` to
  `[&:has([role=checkbox])]:pe-0`.

Leave every `text-right` className used elsewhere in the app on numeric
columns untouched (Global Constraints) — this task only touches the two
files above plus `button.tsx`/`badge.tsx`/`dialog.tsx`.

- [ ] **Step 9: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/components/shell src/components/ui/button.tsx src/components/ui/badge.tsx src/components/ui/dialog.tsx src/components/ui/table.tsx
git commit -m "Add language switcher dropdown, translate nav, fix shared-primitive RTL spacing"
```

---

### Task 3: Login page and Home dashboard translation

**Files:**
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/(app)/page.tsx`
- Modify: `src/components/receipts/customer-section.tsx` *(only the two `text-left` spots — bundled here since it's a one-line-each fix; the rest of that file is translated in Task 6)*

**Interfaces:**
- Consumes: `useLocale()` (Task 1) for the Client Component login page
- Consumes: `resolveLocale()` + `getDictionary()` (Task 1) for the Server Component home page

- [ ] **Step 1: Translate the login page**

Modify `src/app/login/page.tsx` — add the `useLocale` import and replace
every hardcoded string:

```tsx
"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { DesertScene } from "@/components/desert-scene";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/lib/i18n/language-provider";

export default function LoginPage() {
  const { dict } = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.error) {
      setError(dict.login.invalidCredentials);
      return;
    }
    window.location.href = "/";
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-bg-app">
      <DesertScene />

      <div className="absolute start-8 top-7 z-10 flex items-center gap-2 text-[15px] font-bold text-heading">
        <span className="h-[9px] w-[9px] animate-pulse rounded-full bg-primary" />
        FatooraSync
      </div>

      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-[340px] rounded-2xl border border-border-subtle bg-white/90 p-8 shadow-[0_1px_2px_rgba(16,44,30,0.04),0_14px_34px_rgba(16,44,30,0.1),0_4px_10px_rgba(16,44,30,0.06)] backdrop-blur-md"
      >
        <h1 className="text-center text-[19px] font-extrabold text-heading">{dict.login.title}</h1>
        <p className="mb-6 text-center text-xs text-muted-fg">{dict.login.subtitle}</p>

        <div className="mb-4">
          <Label htmlFor="email" className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg">
            {dict.login.email}
          </Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={dict.login.emailPlaceholder}
          />
        </div>

        <div className="mb-4">
          <Label htmlFor="password" className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg">
            {dict.login.password}
          </Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        {error && (
          <p role="alert" className="mb-3 text-xs text-red-600">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" className="w-full">
          {dict.login.signIn}
        </Button>

        <p className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-muted-fg">
          <span className="h-1 w-1 rounded-full bg-accent-mint" />
          {dict.common.poweredBy}
        </p>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Translate the Home dashboard**

Modify `src/app/(app)/page.tsx` — this stays a Server Component; add the
`resolveLocale`/`getDictionary` imports:

```tsx
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { resolveLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/get-dictionary";

export default async function HomePage() {
  const session = await auth();
  const tenantId = session!.user.tenantId;
  const dict = getDictionary(await resolveLocale());

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { tradeNameEn: true },
  });

  const [productCount, customerCount] = await withTenant(tenantId, (tx) =>
    Promise.all([tx.product.count(), tx.customer.count()])
  );

  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-fg">{dict.home.welcomeBack}</div>
      <h1 className="my-2 bg-gradient-to-br from-primary-hover via-primary to-primary-dark bg-clip-text text-5xl font-extrabold text-transparent">
        {tenant.tradeNameEn}
      </h1>
      <p className="mb-9 flex items-center justify-center gap-1.5 text-[11.5px] font-medium text-muted-fg">
        <span className="h-[5px] w-[5px] rounded-full bg-accent-mint" />
        {dict.common.poweredBy}
      </p>

      <div className="flex gap-4">
        <div className="min-w-[130px] rounded-xl border border-border-subtle bg-white px-6 py-4 shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)] transition-transform hover:-translate-y-0.5">
          <div className="text-2xl font-bold text-heading">{productCount}</div>
          <div className="mt-1 text-[11.5px] text-muted-fg">{dict.home.products}</div>
        </div>
        <div className="min-w-[130px] rounded-xl border border-border-subtle bg-white px-6 py-4 shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)] transition-transform hover:-translate-y-0.5">
          <div className="text-2xl font-bold text-heading">{customerCount}</div>
          <div className="mt-1 text-[11.5px] text-muted-fg">{dict.home.customers}</div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Fix the two RTL text-alignment spots in `customer-section.tsx`**

Modify `src/components/receipts/customer-section.tsx` — change both
occurrences of `className="block w-full px-3 py-2 text-left text-sm hover:bg-bg-app"`
(the name-suggestion and VAT-suggestion dropdown buttons) to
`className="block w-full px-3 py-2 text-start text-sm hover:bg-bg-app"`.
This is purely the RTL alignment fix — the rest of this file's text is
translated in Task 6.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/login/page.tsx "src/app/(app)/page.tsx" src/components/receipts/customer-section.tsx
git commit -m "Translate login page and home dashboard, fix customer-section RTL alignment"
```

---

### Task 4: Settings page translation

**Files:**
- Modify: `src/app/(app)/settings/page.tsx`

**Interfaces:**
- Consumes: `useLocale()` (Task 1)

- [ ] **Step 1: Translate the Settings page**

Modify `src/app/(app)/settings/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale } from "@/lib/i18n/language-provider";

export default function SettingsPage() {
  const { dict } = useLocale();
  const [defaultVatRate, setDefaultVatRate] = useState("15");
  const [language, setLanguage] = useState("ar");
  const [printFormat, setPrintFormat] = useState("THERMAL");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setDefaultVatRate(data.defaultVatRate);
        setLanguage(data.language);
        setPrintFormat(data.printFormat);
        setPhone(data.phone ?? "");
      });
  }, []);

  async function handleSave() {
    await fetch("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ defaultVatRate, language, printFormat, phone }),
    });
  }

  return (
    <Card className="max-w-md border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
      <CardHeader>
        <CardTitle className="text-heading">{dict.settings.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="vat" className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg">
            {dict.settings.defaultVatRate}
          </Label>
          <Input id="vat" value={defaultVatRate} onChange={(e) => setDefaultVatRate(e.target.value)} />
        </div>

        <div>
          <Label htmlFor="lang" className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg">
            {dict.settings.language}
          </Label>
          <select
            id="lang"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded-lg border border-input h-8 px-3 text-sm bg-background"
          >
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
          <p className="mt-1.5 text-xs text-muted-fg">{dict.settings.languageCaption}</p>
        </div>

        <div>
          <Label htmlFor="phone" className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg">
            {dict.settings.businessPhone}
          </Label>
          <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+966 5X XXX XXXX" />
        </div>

        <div>
          <Label
            htmlFor="printFormat"
            className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg"
          >
            {dict.settings.printFormat}
          </Label>
          <select
            id="printFormat"
            value={printFormat}
            onChange={(e) => setPrintFormat(e.target.value)}
            className="w-full rounded-lg border border-input h-8 px-3 text-sm bg-background"
          >
            <option value="THERMAL">{dict.settings.thermal}</option>
            <option value="A4">{dict.settings.a4}</option>
          </select>
        </div>

        <Button onClick={handleSave} variant="primary">
          {dict.settings.saveChanges}
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/settings/page.tsx"
git commit -m "Translate Settings page and clarify the Language field's new meaning"
```

---

### Task 5: Products page translation

**Files:**
- Modify: `src/components/products/products-client.tsx`
- Modify: `src/components/products/product-form-dialog.tsx`

**Interfaces:**
- Consumes: `useLocale()` (Task 1)
- Produces: `UNIT_LABELS` stays keyed by the same `unit` values (`PIECE`,
  `KG`, `BOX`, `CARTON`, `LITER`) but its display strings now come from
  `dict.products.units` at render time instead of a module-level constant
  — Task 7's `items-section.tsx` (which imports `UNIT_LABELS` today) is
  updated in that task to call a new exported `getUnitLabels(dict)`
  function instead (see Task 7 Step 3).

- [ ] **Step 1: Translate `product-form-dialog.tsx`, including `UNIT_OPTIONS`**

Modify `src/components/products/product-form-dialog.tsx`. `UNIT_OPTIONS`
becomes a function of the dictionary (since its labels must translate too),
and the standalone `UNIT_LABELS` export becomes `getUnitLabels`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useLocale } from "@/lib/i18n/language-provider";
import type { Dictionary } from "@/lib/i18n/dictionaries/dictionary.types";
import type { SerializedProduct } from "./products-client";

interface ProductFormDialogProps {
  open: boolean;
  product: SerializedProduct | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (product: SerializedProduct) => void;
}

export function getUnitOptions(dict: Dictionary): { value: string; label: string }[] {
  return [
    { value: "PIECE", label: dict.products.units.piece },
    { value: "KG", label: dict.products.units.kg },
    { value: "BOX", label: dict.products.units.box },
    { value: "CARTON", label: dict.products.units.carton },
    { value: "LITER", label: dict.products.units.liter },
  ];
}

export function getUnitLabels(dict: Dictionary): Record<string, string> {
  return Object.fromEntries(getUnitOptions(dict).map((opt) => [opt.value, opt.label]));
}

const EMPTY_FORM = {
  nameEn: "",
  nameAr: "",
  barcode: "",
  unit: "PIECE",
  unitPrice: "",
  useDefaultVat: true,
  vatRate: "",
  quantity: "0",
};

const LABEL_CLASS = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg";

export function ProductFormDialog({ open, product, onOpenChange, onSaved }: ProductFormDialogProps) {
  const { dict } = useLocale();
  const unitOptions = getUnitOptions(dict);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(
        product
          ? {
              nameEn: product.nameEn,
              nameAr: product.nameAr ?? "",
              barcode: product.barcode ?? "",
              unit: product.unit,
              unitPrice: product.unitPrice,
              useDefaultVat: product.vatRate === null,
              vatRate: product.vatRate ?? "",
              quantity: product.quantity,
            }
          : EMPTY_FORM
      );
      setError(null);
      setSaving(false);
    }
  }, [open, product]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const url = product ? `/api/products/${product.id}` : "/api/products";
    const method = product ? "PATCH" : "POST";
    const payload = {
      nameEn: form.nameEn,
      nameAr: form.nameAr,
      barcode: form.barcode,
      unit: form.unit,
      unitPrice: form.unitPrice,
      vatRate: form.useDefaultVat ? null : form.vatRate,
      quantity: form.quantity,
    };

    try {
      const response = await fetch(url, { method, body: JSON.stringify(payload) });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? dict.common.somethingWentWrong);
        return;
      }
      onSaved(body);
    } catch {
      setError(dict.common.somethingWentWrong);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{product ? dict.products.dialogTitleEdit : dict.products.dialogTitleAdd}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="product-name-en" className={LABEL_CLASS}>
                {dict.products.nameEn}
              </Label>
              <Input
                id="product-name-en"
                value={form.nameEn}
                onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
                required
              />
            </div>
            <div>
              <Label htmlFor="product-name-ar" className={LABEL_CLASS}>
                {dict.products.nameAr}
              </Label>
              <Input
                id="product-name-ar"
                value={form.nameAr}
                onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="product-barcode" className={LABEL_CLASS}>
              {dict.products.barcode}
            </Label>
            <Input
              id="product-barcode"
              value={form.barcode}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="product-unit" className={LABEL_CLASS}>
                {dict.products.unit}
              </Label>
              <select
                id="product-unit"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                {unitOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="product-price" className={LABEL_CLASS}>
                {dict.products.unitPrice}
              </Label>
              <Input
                id="product-price"
                type="number"
                step="0.01"
                min="0"
                value={form.unitPrice}
                onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 items-end gap-3">
            <label className="mb-1.5 flex items-center gap-2 text-xs text-body">
              <Checkbox
                checked={form.useDefaultVat}
                onCheckedChange={(checked) => setForm({ ...form, useDefaultVat: checked === true })}
              />
              {dict.products.useDefaultVat}
            </label>
            {!form.useDefaultVat && (
              <div>
                <Label htmlFor="product-vat-rate" className={LABEL_CLASS}>
                  {dict.products.vatRate}
                </Label>
                <Input
                  id="product-vat-rate"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={form.vatRate}
                  onChange={(e) => setForm({ ...form, vatRate: e.target.value })}
                />
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="product-quantity" className={LABEL_CLASS}>
              {dict.products.quantity}
            </Label>
            <Input
              id="product-quantity"
              type="number"
              step="0.001"
              min="0"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
          </div>

          <DialogFooter>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? dict.common.savingEllipsis : dict.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Translate `products-client.tsx`**

Modify `src/components/products/products-client.tsx` — add the
`useLocale` import, replace `UNIT_LABELS` usage with `getUnitLabels(dict)`,
and swap every hardcoded string:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { Product } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useLocale } from "@/lib/i18n/language-provider";
import { ProductFormDialog, getUnitLabels } from "./product-form-dialog";

export type SerializedProduct = Omit<Product, "unitPrice" | "vatRate" | "quantity"> & {
  unitPrice: string;
  vatRate: string | null;
  quantity: string;
};

export function ProductsClient({ initialProducts }: { initialProducts: SerializedProduct[] }) {
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

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products
      .filter((p) => {
        if (!showInactive && !p.isActive) return false;
        if (!query) return true;
        return (
          p.nameEn.toLowerCase().includes(query) ||
          (p.nameAr ?? "").toLowerCase().includes(query) ||
          (p.sku ?? "").toLowerCase().includes(query) ||
          (p.barcode ?? "").toLowerCase().includes(query)
        );
      })
      .sort((a, b) => a.nameEn.localeCompare(b.nameEn));
  }, [products, search, showInactive]);

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Input
            placeholder={dict.products.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72"
          />
          <label className="flex items-center gap-2 text-sm text-body">
            <Checkbox checked={showInactive} onCheckedChange={(checked) => setShowInactive(checked === true)} />
            {dict.common.showInactive}
          </label>
        </div>
        <Button variant="primary" onClick={() => setDialogState({ open: true, product: null })}>
          {dict.common.addProduct}
        </Button>
      </div>

      {actionError && (
        <p role="alert" className="text-xs text-red-600">
          {actionError}
        </p>
      )}

      <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
        {products.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-fg">{dict.products.noProductsYet}</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{dict.products.sku}</TableHead>
                <TableHead>{dict.products.barcode}</TableHead>
                <TableHead>{dict.products.name}</TableHead>
                <TableHead>{dict.products.unit}</TableHead>
                <TableHead className="text-right">{dict.products.unitPrice}</TableHead>
                <TableHead>{dict.products.vat}</TableHead>
                <TableHead className="text-right">{dict.products.quantity}</TableHead>
                <TableHead className="text-right">{dict.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((product) => (
                <TableRow key={product.id} className={!product.isActive ? "opacity-50" : undefined}>
                  <TableCell className="font-mono text-xs">{product.sku ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{product.barcode ?? "—"}</TableCell>
                  <TableCell className="font-medium text-heading">
                    {product.nameEn}
                    {product.nameAr && <div className="text-xs text-muted-fg">{product.nameAr}</div>}
                  </TableCell>
                  <TableCell>{unitLabels[product.unit] ?? product.unit}</TableCell>
                  <TableCell className="text-right">{product.unitPrice}</TableCell>
                  <TableCell>
                    {product.vatRate === null ? (
                      <Badge variant="secondary">{dict.products.defaultBadge}</Badge>
                    ) : (
                      <Badge>{product.vatRate}%</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{product.quantity}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setDialogState({ open: true, product })}>
                        {dict.common.edit}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => toggleActive(product)}>
                        {product.isActive ? dict.common.deactivate : dict.common.reactivate}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <ProductFormDialog
        open={dialogState.open}
        product={dialogState.product}
        onOpenChange={(open) => setDialogState((s) => ({ ...s, open }))}
        onSaved={handleSaved}
      />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors — this also confirms `getUnitLabels`/`getUnitOptions`
are exported correctly and Task 7's `items-section.tsx` reference (added
in that task) will resolve.

- [ ] **Step 4: Commit**

```bash
git add src/components/products
git commit -m "Translate Products page and product dialog"
```

---

### Task 6: Customers page translation

**Files:**
- Modify: `src/components/customers/customers-client.tsx`
- Modify: `src/components/customers/customer-form-dialog.tsx`

**Interfaces:**
- Consumes: `useLocale()` (Task 1)

- [ ] **Step 1: Translate `customer-form-dialog.tsx`**

Modify `src/components/customers/customer-form-dialog.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import type { Customer } from "@prisma/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/lib/i18n/language-provider";

interface CustomerFormDialogProps {
  open: boolean;
  customer: Customer | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (customer: Customer) => void;
}

const EMPTY_FORM = { name: "", vatId: "", crNumber: "", phone: "", address: "" };
const LABEL_CLASS = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg";

export function CustomerFormDialog({ open, customer, onOpenChange, onSaved }: CustomerFormDialogProps) {
  const { dict } = useLocale();
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(
        customer
          ? {
              name: customer.name,
              vatId: customer.vatId ?? "",
              crNumber: customer.crNumber ?? "",
              phone: customer.phone ?? "",
              address: customer.address ?? "",
            }
          : EMPTY_FORM
      );
      setError(null);
      setSaving(false);
    }
  }, [open, customer]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const url = customer ? `/api/customers/${customer.id}` : "/api/customers";
    const method = customer ? "PATCH" : "POST";

    try {
      const response = await fetch(url, { method, body: JSON.stringify(form) });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? dict.common.somethingWentWrong);
        return;
      }
      onSaved(body);
    } catch {
      setError(dict.common.somethingWentWrong);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{customer ? dict.customers.dialogTitleEdit : dict.customers.dialogTitleAdd}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}

          <div>
            <Label htmlFor="customer-name" className={LABEL_CLASS}>
              {dict.customers.name}
            </Label>
            <Input
              id="customer-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>

          <div>
            <Label htmlFor="customer-vat" className={LABEL_CLASS}>
              {dict.customers.vatId}
            </Label>
            <Input id="customer-vat" value={form.vatId} onChange={(e) => setForm({ ...form, vatId: e.target.value })} />
          </div>

          <div>
            <Label htmlFor="customer-cr" className={LABEL_CLASS}>
              {dict.customers.crNumber}
            </Label>
            <Input
              id="customer-cr"
              value={form.crNumber}
              onChange={(e) => setForm({ ...form, crNumber: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="customer-phone" className={LABEL_CLASS}>
              {dict.customers.phone}
            </Label>
            <Input id="customer-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>

          <div>
            <Label htmlFor="customer-address" className={LABEL_CLASS}>
              {dict.customers.address}
            </Label>
            <Input
              id="customer-address"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>

          <DialogFooter>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? dict.common.savingEllipsis : dict.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Translate `customers-client.tsx`**

Modify `src/components/customers/customers-client.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { Customer } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useLocale } from "@/lib/i18n/language-provider";
import { CustomerFormDialog } from "./customer-form-dialog";

export function CustomersClient({ initialCustomers }: { initialCustomers: Customer[] }) {
  const { dict } = useLocale();
  const [customers, setCustomers] = useState(initialCustomers);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [dialogState, setDialogState] = useState<{ open: boolean; customer: Customer | null }>({
    open: false,
    customer: null,
  });
  const [actionError, setActionError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return customers
      .filter((c) => {
        if (!showInactive && !c.isActive) return false;
        if (!query) return true;
        return (
          c.name.toLowerCase().includes(query) ||
          (c.vatId ?? "").toLowerCase().includes(query) ||
          (c.phone ?? "").toLowerCase().includes(query)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, search, showInactive]);

  const hasAnyRealCustomer = customers.some((c) => !c.isWalkIn);

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Input
            placeholder={dict.customers.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72"
          />
          <label className="flex items-center gap-2 text-sm text-body">
            <Checkbox checked={showInactive} onCheckedChange={(checked) => setShowInactive(checked === true)} />
            {dict.common.showInactive}
          </label>
        </div>
        <Button variant="primary" onClick={() => setDialogState({ open: true, customer: null })}>
          + {dict.customers.dialogTitleAdd}
        </Button>
      </div>

      {actionError && (
        <p role="alert" className="text-xs text-red-600">
          {actionError}
        </p>
      )}

      <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
        {!hasAnyRealCustomer ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-fg">{dict.customers.noCustomersYet}</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{dict.customers.name}</TableHead>
                <TableHead>{dict.customers.vatId}</TableHead>
                <TableHead>{dict.customers.crNumber}</TableHead>
                <TableHead>{dict.customers.phone}</TableHead>
                <TableHead>{dict.customers.address}</TableHead>
                <TableHead className="text-right">{dict.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((customer) => (
                <TableRow key={customer.id} className={!customer.isActive ? "opacity-50" : undefined}>
                  <TableCell className="font-medium text-heading">
                    {customer.name}
                    {customer.isWalkIn && (
                      <Badge variant="secondary" className="ms-2">
                        {dict.customers.systemBadge}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{customer.vatId ?? "—"}</TableCell>
                  <TableCell>{customer.crNumber ?? "—"}</TableCell>
                  <TableCell>{customer.phone ?? "—"}</TableCell>
                  <TableCell>{customer.address ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {!customer.isWalkIn && (
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setDialogState({ open: true, customer })}>
                          {dict.common.edit}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => toggleActive(customer)}>
                          {customer.isActive ? dict.common.deactivate : dict.common.reactivate}
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <CustomerFormDialog
        open={dialogState.open}
        customer={dialogState.customer}
        onOpenChange={(open) => setDialogState((s) => ({ ...s, open }))}
        onSaved={handleSaved}
      />
    </div>
  );
}
```

Note: the button label changed from a hardcoded `"+ Add Customer"` string
to `` `+ ${dict.customers.dialogTitleAdd}` `` (`dict.customers.dialogTitleAdd`
is `"Add Customer"`/`"إضافة عميل"`) rather than adding a separate,
near-duplicate `addCustomer` dictionary key — reuses the dialog title text
that already exists for exactly this label, consistent with the `documentForm.itemsSection`/`products.addProduct`
sharing pattern used elsewhere in this dictionary.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/customers
git commit -m "Translate Customers page and customer dialog"
```

---

### Task 7: Receipt/Quotation form translation (Customer section, Items section, Notes, Totals)

**Files:**
- Modify: `src/components/receipts/customer-section.tsx`
- Modify: `src/components/receipts/items-section.tsx`
- Modify: `src/components/receipts/receipt-form.tsx`
- Modify: `src/components/quotations/quotation-form.tsx`

**Interfaces:**
- Consumes: `useLocale()` (Task 1)
- Consumes: `getUnitLabels(dict)` from `src/components/products/product-form-dialog.tsx` (Task 5) — replaces this file's old `UNIT_LABELS` import

- [ ] **Step 1: Translate the rest of `customer-section.tsx`**

Modify `src/components/receipts/customer-section.tsx` (the `text-start`
RTL fix already landed in Task 3 — this step adds the `useLocale` import
and replaces every remaining hardcoded label):

```tsx
"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import type { Customer } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale } from "@/lib/i18n/language-provider";

export interface CustomerDraft {
  name: string;
  vatId: string;
  crNumber: string;
  phone: string;
  address: string;
}

const LABEL_CLASS = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg";

interface CustomerSectionProps {
  customers: Customer[];
  draft: CustomerDraft;
  onDraftChange: (draft: CustomerDraft) => void;
}

function fillFromCustomer(customer: Customer): CustomerDraft {
  return {
    name: customer.name,
    vatId: customer.vatId ?? "",
    crNumber: customer.crNumber ?? "",
    phone: customer.phone ?? "",
    address: customer.address ?? "",
  };
}

export function CustomerSection({ customers, draft, onDraftChange }: CustomerSectionProps) {
  const { dict } = useLocale();
  const [nameSuggestionsOpen, setNameSuggestionsOpen] = useState(false);
  const [vatSuggestionsOpen, setVatSuggestionsOpen] = useState(false);

  const nameMatches = useMemo(() => {
    const query = draft.name.trim().toLowerCase();
    if (!query) return [];
    return customers.filter((c) => !c.isWalkIn && c.vatId && c.name.toLowerCase().includes(query)).slice(0, 8);
  }, [customers, draft.name]);

  const vatMatches = useMemo(() => {
    const query = draft.vatId.trim().toLowerCase();
    if (!query) return [];
    return customers.filter((c) => !c.isWalkIn && (c.vatId ?? "").toLowerCase().includes(query)).slice(0, 8);
  }, [customers, draft.vatId]);

  function selectSuggestion(customer: Customer) {
    onDraftChange(fillFromCustomer(customer));
    setNameSuggestionsOpen(false);
    setVatSuggestionsOpen(false);
  }

  function handleSuggestionKeyDown(e: KeyboardEvent<HTMLInputElement>, matches: Customer[]) {
    if (e.key === "Escape") {
      setNameSuggestionsOpen(false);
      setVatSuggestionsOpen(false);
    } else if (e.key === "Enter" && matches.length > 0) {
      e.preventDefault();
      selectSuggestion(matches[0]);
    }
  }

  return (
    <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)] [--card-spacing:13.5px]">
      <CardHeader>
        <CardTitle className="text-heading">{dict.documentForm.customerSection.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="relative">
            <Label className={LABEL_CLASS}>{dict.documentForm.customerSection.name}</Label>
            <Input
              value={draft.name}
              onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
              onFocus={() => setNameSuggestionsOpen(true)}
              onBlur={() => setTimeout(() => setNameSuggestionsOpen(false), 150)}
              onKeyDown={(e) => handleSuggestionKeyDown(e, nameMatches)}
              autoComplete="off"
            />
            {nameSuggestionsOpen && nameMatches.length > 0 && (
              <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border-subtle bg-bg-card shadow-[0_4px_16px_rgba(16,44,30,0.12)]">
                {nameMatches.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    onMouseDown={() => selectSuggestion(customer)}
                    className="block w-full px-3 py-2 text-start text-sm hover:bg-bg-app"
                  >
                    <span className="text-heading">{customer.name}</span>
                    {customer.vatId && <span className="text-muted-fg"> — {customer.vatId}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <Label className={LABEL_CLASS}>{dict.documentForm.customerSection.vatId}</Label>
            <Input
              value={draft.vatId}
              onChange={(e) => onDraftChange({ ...draft, vatId: e.target.value })}
              onFocus={() => setVatSuggestionsOpen(true)}
              onBlur={() => setTimeout(() => setVatSuggestionsOpen(false), 150)}
              onKeyDown={(e) => handleSuggestionKeyDown(e, vatMatches)}
              autoComplete="off"
            />
            {vatSuggestionsOpen && vatMatches.length > 0 && (
              <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border-subtle bg-bg-card shadow-[0_4px_16px_rgba(16,44,30,0.12)]">
                {vatMatches.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    onMouseDown={() => selectSuggestion(customer)}
                    className="block w-full px-3 py-2 text-start text-sm hover:bg-bg-app"
                  >
                    <span className="text-heading">{customer.vatId}</span>
                    <span className="text-muted-fg"> — {customer.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <Label className={LABEL_CLASS}>{dict.documentForm.customerSection.crNumber}</Label>
            <Input
              value={draft.crNumber}
              onChange={(e) => onDraftChange({ ...draft, crNumber: e.target.value })}
            />
          </div>
          <div>
            <Label className={LABEL_CLASS}>{dict.documentForm.customerSection.phone}</Label>
            <Input value={draft.phone} onChange={(e) => onDraftChange({ ...draft, phone: e.target.value })} />
          </div>
        </div>
        <div>
          <Label className={LABEL_CLASS}>{dict.documentForm.customerSection.address}</Label>
          <Input value={draft.address} onChange={(e) => onDraftChange({ ...draft, address: e.target.value })} />
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Translate `items-section.tsx`**

Modify `src/components/receipts/items-section.tsx` — replace the
`UNIT_LABELS` import with `getUnitLabels`, add `useLocale`, and translate
every string (the `text-right` classNames on Qty/Price/Disc./VAT/Total/
Actions stay exactly as-is per Global Constraints; only the one
`text-left` on the search-suggestion button, already covered by the same
pattern as `customer-section.tsx`, becomes `text-start`):

```tsx
"use client";

import { useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { getUnitLabels } from "@/components/products/product-form-dialog";
import type { SerializedProduct } from "@/components/products/products-client";
import type { LineTotals } from "@/lib/receipts/calculate-totals";
import { useLocale } from "@/lib/i18n/language-provider";

export interface ReceiptLine {
  key: string;
  productId: string;
  sku: string | null;
  productName: string;
  productNameAr: string | null;
  unit: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  vatRate: string | null;
  stockAtAdd: string;
}

interface ItemsSectionProps {
  products: SerializedProduct[];
  lines: ReceiptLine[];
  lineTotals: LineTotals[];
  onAddLine: (product: SerializedProduct) => void;
  onRemoveLine: (key: string) => void;
  onQuantityChange: (key: string, quantity: string) => void;
  onUnitPriceChange: (key: string, unitPrice: string) => void;
  onDiscountChange: (key: string, discount: string) => void;
  onTotalChange: (key: string, total: string) => void;
  onOpenQuickCreate: () => void;
}

export function ItemsSection({
  products,
  lines,
  lineTotals,
  onAddLine,
  onRemoveLine,
  onQuantityChange,
  onUnitPriceChange,
  onDiscountChange,
  onTotalChange,
  onOpenQuickCreate,
}: ItemsSectionProps) {
  const { dict } = useLocale();
  const unitLabels = getUnitLabels(dict);
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [totalDrafts, setTotalDrafts] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return products.filter(
      (p) =>
        p.nameEn.toLowerCase().includes(query) ||
        (p.nameAr ?? "").toLowerCase().includes(query) ||
        (p.sku ?? "").toLowerCase().includes(query) ||
        (p.barcode ?? "").toLowerCase().includes(query)
    );
  }, [products, search]);

  function handleSelect(product: SerializedProduct) {
    onAddLine(product);
    setSearch("");
  }

  function commitTotalDraft(key: string, seededValue: string) {
    const draft = totalDrafts[key];
    if (draft !== undefined && draft !== seededValue) {
      onTotalChange(key, draft);
    }
    setTotalDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  return (
    <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)] [--card-spacing:18.5px]">
      <CardHeader>
        <CardTitle className="text-heading">{dict.documentForm.itemsSection.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              ref={searchInputRef}
              placeholder={dict.documentForm.itemsSection.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            {search.trim() && (
              <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border-subtle bg-bg-card shadow-[0_4px_16px_rgba(16,44,30,0.12)]">
                {filtered.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => handleSelect(product)}
                    className="block w-full px-3 py-2 text-start text-sm hover:bg-bg-app"
                  >
                    <span className="font-mono text-xs text-muted-fg">{product.sku}</span>{" "}
                    <span className="text-heading">{product.nameEn}</span>{" "}
                    <span className="text-muted-fg">— {product.unitPrice}</span>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-fg">{dict.documentForm.itemsSection.noMatches}</div>
                )}
              </div>
            )}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onOpenQuickCreate} className="shrink-0">
            {dict.common.addProduct}
          </Button>
        </div>

        {lines.length > 0 && (
          <div className="max-h-[425px] overflow-y-auto rounded-lg border border-border-subtle">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{dict.documentForm.itemsSection.headers.number}</TableHead>
                  <TableHead>{dict.documentForm.itemsSection.headers.sku}</TableHead>
                  <TableHead>{dict.documentForm.itemsSection.headers.product}</TableHead>
                  <TableHead>{dict.documentForm.itemsSection.headers.unit}</TableHead>
                  <TableHead className="text-right">{dict.documentForm.itemsSection.headers.qty}</TableHead>
                  <TableHead className="text-right">{dict.documentForm.itemsSection.headers.price}</TableHead>
                  <TableHead className="text-right">{dict.documentForm.itemsSection.headers.disc}</TableHead>
                  <TableHead className="text-right">{dict.documentForm.itemsSection.headers.vat}</TableHead>
                  <TableHead className="text-right">{dict.documentForm.itemsSection.headers.total}</TableHead>
                  <TableHead className="bg-bg-card text-right">
                    {dict.documentForm.itemsSection.headers.actions}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, index) => {
                  const exceedsStock = Number(line.quantity) > Number(line.stockAtAdd);
                  const rawSubtotal = Number(line.unitPrice) * Number(line.quantity);
                  const discountExceedsSubtotal = Number(line.discount) > rawSubtotal;
                  const { lineVat, lineTotal } = lineTotals[index];
                  return (
                    <TableRow key={line.key} className="group">
                      <TableCell className="text-muted-fg">{index + 1}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono">
                          {line.sku ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-heading">{line.productName}</div>
                        {line.productNameAr && (
                          <div className="text-xs text-emerald-600 dark:text-emerald-400">{line.productNameAr}</div>
                        )}
                        {exceedsStock && (
                          <div className="text-xs text-amber-600">{dict.documentForm.itemsSection.exceedsStock}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-fg">{unitLabels[line.unit] ?? line.unit}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="0.001"
                          min="0.001"
                          value={line.quantity}
                          onChange={(e) => onQuantityChange(line.key, e.target.value)}
                          className="w-16 text-right"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.unitPrice}
                          onChange={(e) => onUnitPriceChange(line.key, e.target.value)}
                          className="w-24 text-right"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.discount}
                          onChange={(e) => onDiscountChange(line.key, e.target.value)}
                          className="w-16 text-right"
                        />
                        {discountExceedsSubtotal && (
                          <div className="text-xs text-red-600">{dict.documentForm.itemsSection.exceedsSubtotal}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-fg">{lineVat.toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={totalDrafts[line.key] ?? lineTotal.toFixed(2)}
                          onFocus={() =>
                            setTotalDrafts((prev) => ({ ...prev, [line.key]: lineTotal.toFixed(2) }))
                          }
                          onChange={(e) =>
                            setTotalDrafts((prev) => ({ ...prev, [line.key]: e.target.value }))
                          }
                          onBlur={() => commitTotalDraft(line.key, lineTotal.toFixed(2))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                          className="w-24 text-right font-semibold text-heading"
                        />
                      </TableCell>
                      <TableCell className="text-right group-hover:bg-muted/50">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            aria-label="Confirm line, focus search"
                            onClick={() => searchInputRef.current?.focus()}
                            className="rounded-md p-1 text-emerald-600 hover:bg-emerald-600/10"
                          >
                            <Check className="size-4" />
                          </button>
                          <button
                            type="button"
                            aria-label="Remove item"
                            onClick={() => onRemoveLine(line.key)}
                            className="rounded-md p-1 text-red-600 hover:bg-red-600/10"
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Translate `receipt-form.tsx`**

Modify `src/components/receipts/receipt-form.tsx` — add the `useLocale`
import and replace the Notes/Totals card text and button/error strings
(the rest of the file — handlers, calculation logic, grid layout — is
unchanged):

```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Customer } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductFormDialog } from "@/components/products/product-form-dialog";
import type { SerializedProduct } from "@/components/products/products-client";
import { round2, calculateLine, calculateDocumentTotals, deriveUnitPriceFromTotal } from "@/lib/receipts/calculate-totals";
import { useLocale } from "@/lib/i18n/language-provider";
import { CustomerSection, type CustomerDraft } from "./customer-section";
import { ItemsSection, type ReceiptLine } from "./items-section";

const EMPTY_CUSTOMER_DRAFT: CustomerDraft = { name: "", vatId: "", crNumber: "", phone: "", address: "" };

interface ReceiptFormProps {
  initialCustomers: Customer[];
  initialProducts: SerializedProduct[];
  defaultVatRate: string;
}

export function ReceiptForm({ initialCustomers, initialProducts, defaultVatRate }: ReceiptFormProps) {
  const router = useRouter();
  const { dict } = useLocale();
  const [customers, setCustomers] = useState(initialCustomers);
  const [products, setProducts] = useState(initialProducts);

  const [customerDraft, setCustomerDraft] = useState<CustomerDraft>(EMPTY_CUSTOMER_DRAFT);

  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [notes, setNotes] = useState("");
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lineTotals = useMemo(
    () =>
      lines.map((line) =>
        calculateLine({
          unitPrice: round2(Number(line.unitPrice)),
          quantity: Number(line.quantity),
          vatRate: Number(line.vatRate ?? defaultVatRate),
          discount: Number(line.discount),
        })
      ),
    [lines, defaultVatRate]
  );
  const documentTotals = useMemo(() => calculateDocumentTotals(lineTotals), [lineTotals]);

  function addLine(product: SerializedProduct) {
    setLines((prev) => [
      ...prev,
      {
        key: `${product.id}-${prev.length}-${Date.now()}`,
        productId: product.id,
        sku: product.sku,
        productName: product.nameEn,
        productNameAr: product.nameAr,
        unit: product.unit,
        quantity: "1",
        unitPrice: product.unitPrice,
        discount: "0",
        vatRate: product.vatRate,
        stockAtAdd: product.quantity,
      },
    ]);
  }

  function handleQuickCreateSaved(product: SerializedProduct) {
    setProducts((prev) => [...prev, product]);
    addLine(product);
    setQuickCreateOpen(false);
  }

  function handleUnitPriceChange(key: string, unitPrice: string) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, unitPrice } : line)));
  }

  function handleTotalChange(key: string, rawTotal: string) {
    const newTotal = Number(rawTotal);
    if (!Number.isFinite(newTotal) || newTotal < 0) return;
    setLines((prev) =>
      prev.map((line) => {
        if (line.key !== key) return line;
        const quantity = Number(line.quantity);
        if (!(quantity > 0)) return line;
        const vatRate = Number(line.vatRate ?? defaultVatRate);
        const unitPrice = deriveUnitPriceFromTotal({
          lineTotal: newTotal,
          quantity,
          discount: Number(line.discount),
          vatRate,
        });
        return { ...line, unitPrice: unitPrice.toFixed(2) };
      })
    );
  }

  function resetForm() {
    setCustomerDraft(EMPTY_CUSTOMER_DRAFT);
    setLines([]);
    setNotes("");
    setError(null);
  }

  async function handleSave(printAfter: boolean) {
    if (lines.length === 0) {
      setError(dict.documentForm.totals.addAtLeastOneItem);
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      customer: customerDraft,
      lines: lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        discount: line.discount,
        unitPrice: line.unitPrice,
      })),
      notes,
    };

    try {
      const response = await fetch("/api/receipts", { method: "POST", body: JSON.stringify(payload) });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? dict.common.somethingWentWrong);
        setSaving(false);
        return;
      }

      const trimmedName = customerDraft.name.trim();
      const trimmedVatId = customerDraft.vatId.trim();
      if (trimmedName && trimmedVatId) {
        setCustomers((prev) => {
          if (prev.some((c) => c.vatId === trimmedVatId)) return prev;
          return [
            ...prev,
            {
              id: body.customerId,
              tenantId: "",
              name: trimmedName,
              vatId: trimmedVatId,
              crNumber: customerDraft.crNumber.trim() || null,
              phone: customerDraft.phone.trim() || null,
              address: customerDraft.address.trim() || null,
              isWalkIn: false,
              isActive: true,
              createdAt: new Date(),
            },
          ];
        });
      }

      if (printAfter) {
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

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[4fr_1fr]">
      <CustomerSection customers={customers} draft={customerDraft} onDraftChange={setCustomerDraft} />

      <Card className="flex flex-col border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)] [--card-spacing:13.5px]">
        <CardHeader>
          <CardTitle className="text-heading">{dict.documentForm.notesTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full flex-1 rounded-lg border border-input bg-transparent p-2.5 text-sm"
          />
        </CardContent>
      </Card>

      <ItemsSection
        products={products}
        lines={lines}
        lineTotals={lineTotals}
        onAddLine={addLine}
        onRemoveLine={(key) => setLines((prev) => prev.filter((l) => l.key !== key))}
        onQuantityChange={(key, quantity) =>
          setLines((prev) => prev.map((l) => (l.key === key ? { ...l, quantity } : l)))
        }
        onUnitPriceChange={handleUnitPriceChange}
        onDiscountChange={(key, discount) =>
          setLines((prev) => prev.map((l) => (l.key === key ? { ...l, discount } : l)))
        }
        onTotalChange={handleTotalChange}
        onOpenQuickCreate={() => setQuickCreateOpen(true)}
      />

      <Card className="sticky top-4 self-start border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)] [--card-spacing:18.5px]">
        <CardHeader>
          <CardTitle className="text-heading">{dict.documentForm.totals.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
          <div className="flex justify-between text-sm text-body">
            <span>{dict.documentForm.totals.subtotal}</span>
            <span>{documentTotals.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm text-body">
            <span>{dict.documentForm.totals.totalVat}</span>
            <span>{documentTotals.vatTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-lg font-bold text-heading">
            <span>{dict.documentForm.totals.grandTotal}</span>
            <span>{documentTotals.grandTotal.toFixed(2)}</span>
          </div>
          <Button
            type="button"
            variant="primary"
            className="w-full"
            disabled={saving}
            onClick={() => handleSave(true)}
          >
            {saving ? dict.common.savingEllipsis : dict.documentForm.totals.savePrint}
          </Button>
          <Button type="button" variant="outline" className="w-full" disabled={saving} onClick={() => handleSave(false)}>
            {dict.common.save}
          </Button>
        </CardContent>
      </Card>

      <ProductFormDialog
        open={quickCreateOpen}
        product={null}
        onOpenChange={setQuickCreateOpen}
        onSaved={handleQuickCreateSaved}
      />
    </div>
  );
}
```

- [ ] **Step 4: Translate `quotation-form.tsx`**

Modify `src/components/quotations/quotation-form.tsx` the same way,
mirroring Step 3 exactly (this file already duplicates `receipt-form.tsx`
per this project's established convention):

```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Customer } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductFormDialog } from "@/components/products/product-form-dialog";
import type { SerializedProduct } from "@/components/products/products-client";
import { round2, calculateLine, calculateDocumentTotals, deriveUnitPriceFromTotal } from "@/lib/receipts/calculate-totals";
import { useLocale } from "@/lib/i18n/language-provider";
import { CustomerSection, type CustomerDraft } from "@/components/receipts/customer-section";
import { ItemsSection, type ReceiptLine } from "@/components/receipts/items-section";

const EMPTY_CUSTOMER_DRAFT: CustomerDraft = { name: "", vatId: "", crNumber: "", phone: "", address: "" };

interface QuotationFormProps {
  initialCustomers: Customer[];
  initialProducts: SerializedProduct[];
  defaultVatRate: string;
}

export function QuotationForm({ initialCustomers, initialProducts, defaultVatRate }: QuotationFormProps) {
  const router = useRouter();
  const { dict } = useLocale();
  const [customers, setCustomers] = useState(initialCustomers);
  const [products, setProducts] = useState(initialProducts);

  const [customerDraft, setCustomerDraft] = useState<CustomerDraft>(EMPTY_CUSTOMER_DRAFT);

  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [notes, setNotes] = useState("");
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lineTotals = useMemo(
    () =>
      lines.map((line) =>
        calculateLine({
          unitPrice: round2(Number(line.unitPrice)),
          quantity: Number(line.quantity),
          vatRate: Number(line.vatRate ?? defaultVatRate),
          discount: Number(line.discount),
        })
      ),
    [lines, defaultVatRate]
  );
  const documentTotals = useMemo(() => calculateDocumentTotals(lineTotals), [lineTotals]);

  function addLine(product: SerializedProduct) {
    setLines((prev) => [
      ...prev,
      {
        key: `${product.id}-${prev.length}-${Date.now()}`,
        productId: product.id,
        sku: product.sku,
        productName: product.nameEn,
        productNameAr: product.nameAr,
        unit: product.unit,
        quantity: "1",
        unitPrice: product.unitPrice,
        discount: "0",
        vatRate: product.vatRate,
        stockAtAdd: product.quantity,
      },
    ]);
  }

  function handleQuickCreateSaved(product: SerializedProduct) {
    setProducts((prev) => [...prev, product]);
    addLine(product);
    setQuickCreateOpen(false);
  }

  function handleUnitPriceChange(key: string, unitPrice: string) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, unitPrice } : line)));
  }

  function handleTotalChange(key: string, rawTotal: string) {
    const newTotal = Number(rawTotal);
    if (!Number.isFinite(newTotal) || newTotal < 0) return;
    setLines((prev) =>
      prev.map((line) => {
        if (line.key !== key) return line;
        const quantity = Number(line.quantity);
        if (!(quantity > 0)) return line;
        const vatRate = Number(line.vatRate ?? defaultVatRate);
        const unitPrice = deriveUnitPriceFromTotal({
          lineTotal: newTotal,
          quantity,
          discount: Number(line.discount),
          vatRate,
        });
        return { ...line, unitPrice: unitPrice.toFixed(2) };
      })
    );
  }

  function resetForm() {
    setCustomerDraft(EMPTY_CUSTOMER_DRAFT);
    setLines([]);
    setNotes("");
    setError(null);
  }

  async function handleSave(printAfter: boolean) {
    if (lines.length === 0) {
      setError(dict.documentForm.totals.addAtLeastOneItem);
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      customer: customerDraft,
      lines: lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        discount: line.discount,
        unitPrice: line.unitPrice,
      })),
      notes,
    };

    try {
      const response = await fetch("/api/quotations", { method: "POST", body: JSON.stringify(payload) });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? dict.common.somethingWentWrong);
        setSaving(false);
        return;
      }

      const trimmedName = customerDraft.name.trim();
      const trimmedVatId = customerDraft.vatId.trim();
      if (trimmedName && trimmedVatId) {
        setCustomers((prev) => {
          if (prev.some((c) => c.vatId === trimmedVatId)) return prev;
          return [
            ...prev,
            {
              id: body.customerId,
              tenantId: "",
              name: trimmedName,
              vatId: trimmedVatId,
              crNumber: customerDraft.crNumber.trim() || null,
              phone: customerDraft.phone.trim() || null,
              address: customerDraft.address.trim() || null,
              isWalkIn: false,
              isActive: true,
              createdAt: new Date(),
            },
          ];
        });
      }

      if (printAfter) {
        router.push(`/quotations/${body.id}/print`);
      } else {
        resetForm();
        setSaving(false);
      }
    } catch {
      setError(dict.common.somethingWentWrong);
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[4fr_1fr]">
      <CustomerSection customers={customers} draft={customerDraft} onDraftChange={setCustomerDraft} />

      <Card className="flex flex-col border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)] [--card-spacing:13.5px]">
        <CardHeader>
          <CardTitle className="text-heading">{dict.documentForm.notesTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full flex-1 rounded-lg border border-input bg-transparent p-2.5 text-sm"
          />
        </CardContent>
      </Card>

      <ItemsSection
        products={products}
        lines={lines}
        lineTotals={lineTotals}
        onAddLine={addLine}
        onRemoveLine={(key) => setLines((prev) => prev.filter((l) => l.key !== key))}
        onQuantityChange={(key, quantity) =>
          setLines((prev) => prev.map((l) => (l.key === key ? { ...l, quantity } : l)))
        }
        onUnitPriceChange={handleUnitPriceChange}
        onDiscountChange={(key, discount) =>
          setLines((prev) => prev.map((l) => (l.key === key ? { ...l, discount } : l)))
        }
        onTotalChange={handleTotalChange}
        onOpenQuickCreate={() => setQuickCreateOpen(true)}
      />

      <Card className="sticky top-4 self-start border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)] [--card-spacing:18.5px]">
        <CardHeader>
          <CardTitle className="text-heading">{dict.documentForm.totals.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
          <div className="flex justify-between text-sm text-body">
            <span>{dict.documentForm.totals.subtotal}</span>
            <span>{documentTotals.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm text-body">
            <span>{dict.documentForm.totals.totalVat}</span>
            <span>{documentTotals.vatTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-lg font-bold text-heading">
            <span>{dict.documentForm.totals.grandTotal}</span>
            <span>{documentTotals.grandTotal.toFixed(2)}</span>
          </div>
          <Button
            type="button"
            variant="primary"
            className="w-full"
            disabled={saving}
            onClick={() => handleSave(true)}
          >
            {saving ? dict.common.savingEllipsis : dict.documentForm.totals.savePrint}
          </Button>
          <Button type="button" variant="outline" className="w-full" disabled={saving} onClick={() => handleSave(false)}>
            {dict.common.save}
          </Button>
        </CardContent>
      </Card>

      <ProductFormDialog
        open={quickCreateOpen}
        product={null}
        onOpenChange={setQuickCreateOpen}
        onSaved={handleQuickCreateSaved}
      />
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/receipts/customer-section.tsx src/components/receipts/items-section.tsx src/components/receipts/receipt-form.tsx src/components/quotations/quotation-form.tsx
git commit -m "Translate New Receipt/New Quotation forms (Customer, Items, Notes, Totals)"
```

---

### Task 8: Receipt/Quotation History pages and print-page chrome translation

**Files:**
- Modify: `src/components/receipts/receipt-history-client.tsx`
- Modify: `src/components/quotations/quotation-history-client.tsx`
- Modify: `src/components/receipts/print-button.tsx`

**Interfaces:**
- Consumes: `useLocale()` (Task 1)

- [ ] **Step 1: Translate `receipt-history-client.tsx`**

Modify `src/components/receipts/receipt-history-client.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PAGE_SIZE } from "@/lib/receipts/constants";
import { useLocale } from "@/lib/i18n/language-provider";

interface ReceiptRow {
  id: string;
  number: number;
  customerName: string;
  customerVatId: string | null;
  createdAt: string;
  grandTotal: string;
}

interface ReceiptsResponse {
  receipts: ReceiptRow[];
  total: number;
  page: number;
  pageSize: number;
}

const EMPTY: ReceiptsResponse = { receipts: [], total: 0, page: 1, pageSize: PAGE_SIZE };

export function ReceiptHistoryClient({ initial }: { initial: ReceiptsResponse }) {
  const { dict } = useLocale();
  const [data, setData] = useState<ReceiptsResponse>(initial);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRun = useRef(true);

  async function fetchPage(targetPage: number) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(targetPage) });
      if (search.trim()) params.set("search", search.trim());
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const response = await fetch(`/api/receipts?${params.toString()}`);
      if (!response.ok) {
        setError(dict.receiptHistory.loadError);
        setData(EMPTY);
        return;
      }
      const body: ReceiptsResponse = await response.json();
      setData(body);
    } catch {
      setError(dict.receiptHistory.loadError);
      setData(EMPTY);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, dateFrom, dateTo]);

  function goToPage(targetPage: number) {
    setPage(targetPage);
    fetchPage(targetPage);
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={dict.receiptHistory.searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72"
        />
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
        <span className="text-sm text-muted-fg">{dict.common.to}</span>
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}

      <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
        {data.total === 0 && !loading ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-fg">
              {search || dateFrom || dateTo ? dict.receiptHistory.noMatching : dict.receiptHistory.noneYet}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{dict.receiptHistory.number}</TableHead>
                <TableHead>{dict.receiptHistory.customer}</TableHead>
                <TableHead>{dict.receiptHistory.date}</TableHead>
                <TableHead className="text-right">{dict.receiptHistory.total}</TableHead>
                <TableHead className="text-right">{dict.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-fg">
                    {dict.common.loading}
                  </TableCell>
                </TableRow>
              ) : (
                data.receipts.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">#{r.number}</TableCell>
                    <TableCell>
                      <div className="font-medium text-heading">{r.customerName}</div>
                      {r.customerVatId && <div className="text-xs text-muted-fg">{r.customerVatId}</div>}
                    </TableCell>
                    <TableCell>{r.createdAt.slice(0, 10)}</TableCell>
                    <TableCell className="text-right font-semibold text-heading">
                      {Number(r.grandTotal).toFixed(2)} SAR
                    </TableCell>
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
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      {data.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-fg">
          <span>{dict.common.totalMatches(data.total)}</span>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => goToPage(page - 1)}>
              {dict.common.previous}
            </Button>
            <span>{dict.common.pageOf(page, totalPages)}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => goToPage(page + 1)}
            >
              {dict.common.next}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Translate `quotation-history-client.tsx`**

Modify `src/components/quotations/quotation-history-client.tsx` the same
way, mirroring Step 1 with `dict.quotationHistory.*` in place of
`dict.receiptHistory.*` and the `/api/quotations`/`/quotations/${q.id}`
routes unchanged:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PAGE_SIZE } from "@/lib/receipts/constants";
import { useLocale } from "@/lib/i18n/language-provider";

interface QuotationRow {
  id: string;
  number: number;
  customerName: string;
  customerVatId: string | null;
  createdAt: string;
  grandTotal: string;
}

interface QuotationsResponse {
  quotations: QuotationRow[];
  total: number;
  page: number;
  pageSize: number;
}

const EMPTY: QuotationsResponse = { quotations: [], total: 0, page: 1, pageSize: PAGE_SIZE };

export function QuotationHistoryClient({ initial }: { initial: QuotationsResponse }) {
  const { dict } = useLocale();
  const [data, setData] = useState<QuotationsResponse>(initial);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRun = useRef(true);

  async function fetchPage(targetPage: number) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(targetPage) });
      if (search.trim()) params.set("search", search.trim());
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const response = await fetch(`/api/quotations?${params.toString()}`);
      if (!response.ok) {
        setError(dict.quotationHistory.loadError);
        setData(EMPTY);
        return;
      }
      const body: QuotationsResponse = await response.json();
      setData(body);
    } catch {
      setError(dict.quotationHistory.loadError);
      setData(EMPTY);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, dateFrom, dateTo]);

  function goToPage(targetPage: number) {
    setPage(targetPage);
    fetchPage(targetPage);
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={dict.quotationHistory.searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72"
        />
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
        <span className="text-sm text-muted-fg">{dict.common.to}</span>
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}

      <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
        {data.total === 0 && !loading ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-fg">
              {search || dateFrom || dateTo ? dict.quotationHistory.noMatching : dict.quotationHistory.noneYet}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{dict.quotationHistory.number}</TableHead>
                <TableHead>{dict.quotationHistory.customer}</TableHead>
                <TableHead>{dict.quotationHistory.date}</TableHead>
                <TableHead className="text-right">{dict.quotationHistory.total}</TableHead>
                <TableHead className="text-right">{dict.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-fg">
                    {dict.common.loading}
                  </TableCell>
                </TableRow>
              ) : (
                data.quotations.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="font-mono text-xs">#{q.number}</TableCell>
                    <TableCell>
                      <div className="font-medium text-heading">{q.customerName}</div>
                      {q.customerVatId && <div className="text-xs text-muted-fg">{q.customerVatId}</div>}
                    </TableCell>
                    <TableCell>{q.createdAt.slice(0, 10)}</TableCell>
                    <TableCell className="text-right font-semibold text-heading">
                      {Number(q.grandTotal).toFixed(2)} SAR
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/quotations/${q.id}/print`}>{dict.common.view}</Link>
                        </Button>
                        <Button variant="outline" size="sm" asChild>
                          <a href={`/api/quotations/${q.id}/pdf`}>{dict.common.download}</a>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      {data.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-fg">
          <span>{dict.common.totalMatches(data.total)}</span>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => goToPage(page - 1)}>
              {dict.common.previous}
            </Button>
            <span>{dict.common.pageOf(page, totalPages)}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => goToPage(page + 1)}
            >
              {dict.common.next}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Translate `print-button.tsx`**

Modify `src/components/receipts/print-button.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/language-provider";

export function PrintButton() {
  const { dict } = useLocale();
  return (
    <Button
      type="button"
      variant="primary"
      onClick={() => window.print()}
      className="mx-auto mt-4 block print:hidden"
    >
      {dict.printChrome.print}
    </Button>
  );
}
```

- [ ] **Step 4: Typecheck and lint the whole branch**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `set -a && source .env && set +a && npm test`
Expected: all existing tests still pass (this feature added no new API/
route logic, only UI text and a pure `pickLocale` function already covered
by Task 1's tests), plus the new i18n tests from Task 1.

- [ ] **Step 6: Commit**

```bash
git add src/components/receipts/receipt-history-client.tsx src/components/quotations/quotation-history-client.tsx src/components/receipts/print-button.tsx
git commit -m "Translate Receipt/Quotation History pages and print-page chrome"
```

---

## Manual Verification (after all tasks land)

Not automatable — run once the branch is otherwise green:

1. Start the dev server, log in, confirm the nav dropdown shows next to
   the user's email in the Topbar.
2. Switch to العربية: confirm `<html dir="rtl" lang="ar">`, the sidebar
   visually moves to the right, and the font switches to the Arabic face.
3. Spot-check Home, Settings, Products (list + Add/Edit dialog), Customers
   (list + Add/Edit dialog), New Receipt (Customer/Items/Notes/Totals),
   New Quotation, Receipt History, Quotation History — confirm every label
   is in Arabic with no leftover English strings, and numeric columns
   (Qty/Price/VAT/Total) stay right-aligned.
4. Confirm a receipt/quotation's printed A4 and thermal output is
   unchanged in both app-language modes (still bilingual, same layout as
   before this feature).
5. Log out and reload `/login` in a fresh browser profile (no cookie) —
   confirm it defaults to English; set the demo tenant's Settings.language
   to `"en"` temporarily and reload in yet another fresh profile to confirm
   the shop-default fallback path also works, then restore it to `"ar"`.
6. Switch back to English and confirm the layout returns to LTR with no
   leftover RTL artifacts (e.g. dialog close button position, table header
   alignment).
