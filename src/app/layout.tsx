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
