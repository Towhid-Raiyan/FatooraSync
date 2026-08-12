import path from "path";
import { Font } from "@react-pdf/renderer";

// Shared between the Receipt and Quotation A4 PDF templates. @react-pdf/renderer
// needs real .ttf files (Google Fonts' own CSS delivery is woff/woff2), and
// @expo-google-fonts/prata ships one (confirmed via `npm pack --dry-run`),
// OFL-1.1 licensed -- free to embed in a commercial product.
const PRATA_DIR = path.join(process.cwd(), "node_modules/@expo-google-fonts/prata");
Font.register({
  family: "Prata",
  fonts: [{ src: path.join(PRATA_DIR, "400Regular/Prata_400Regular.ttf") }],
});

// The body font is IBM Plex Sans Arabic -- not "Inter" -- for the same reason the
// thermal PDF template (receipt-pdf.tsx) uses it: it's the one font already
// vendored in this project that covers both Latin and Arabic glyphs, and
// @react-pdf/renderer has no automatic font-fallback substitution the way a
// browser does. Body text here can genuinely contain Arabic (the tenant's trade
// name, a customer's name, free-text notes), and "Inter" simply has no Arabic
// glyphs at all -- confirmed by a real rendered check that produced garbled
// boxes for the Arabic trade name before this fix. Same vendored TTF paths
// receipt-pdf.tsx already uses.
const ARABIC_DIR = path.join(process.cwd(), "node_modules/@expo-google-fonts/ibm-plex-sans-arabic");
Font.register({
  family: "IBM Plex Sans Arabic",
  fonts: [
    { src: path.join(ARABIC_DIR, "400Regular/IBMPlexSansArabic_400Regular.ttf"), fontWeight: "normal" },
    { src: path.join(ARABIC_DIR, "700Bold/IBMPlexSansArabic_700Bold.ttf"), fontWeight: "bold" },
  ],
});
