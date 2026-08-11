import path from "path";
import { Font } from "@react-pdf/renderer";

// Shared between the Receipt and Quotation A4 PDF templates -- both need the identical
// Prata + Inter registration. Same vendored-TTF reasoning as receipt-pdf.tsx's Arabic
// font comment: @react-pdf/renderer needs real .ttf files, and Google Fonts' own CSS
// delivery is woff/woff2. @expo-google-fonts/prata and @expo-google-fonts/inter both
// ship real .ttf files (confirmed via `npm pack --dry-run`), and both are OFL-1.1
// licensed -- free to embed in a commercial product.
const PRATA_DIR = path.join(process.cwd(), "node_modules/@expo-google-fonts/prata");
const INTER_DIR = path.join(process.cwd(), "node_modules/@expo-google-fonts/inter");

Font.register({
  family: "Prata",
  fonts: [{ src: path.join(PRATA_DIR, "400Regular/Prata_400Regular.ttf") }],
});
Font.register({
  family: "Inter",
  fonts: [
    { src: path.join(INTER_DIR, "400Regular/Inter_400Regular.ttf"), fontWeight: "normal" },
    { src: path.join(INTER_DIR, "600SemiBold/Inter_600SemiBold.ttf"), fontWeight: "bold" },
  ],
});
