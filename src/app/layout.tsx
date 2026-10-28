import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

/**
 * ── TYPOGRAPHIE GLOBALE STUDYFORGE AI ─────────────────────────────────────────
 * Police principale : Bricolage Grotesque (importée depuis Google Fonts via
 * next/font — auto-hébergée, zéro décalage de mise en page, fallback ajusté
 * automatiquement, `font-display: swap`).
 * Police de code : JetBrains Mono (éditeurs, console, zones SQL).
 * ──────────────────────────────────────────────────────────────────────────────
 */
const bricolageGrotesque = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
  display: "swap",
  fallback: ["Segoe UI", "system-ui", "Arial", "sans-serif"],
  adjustFontFallback: true,
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
  fallback: ["ui-monospace", "Menlo", "Consolas", "monospace"],
});

export const metadata: Metadata = {
  title: "StudyForge AI — Plateforme d'apprentissage assistée par IA",
  description:
    "Importez vos cours, générez des exercices personnalisés, codez et pratiquez le SQL, suivez votre progression. Plateforme personnelle d'apprentissage assistée par intelligence artificielle.",
  icons: {
    icon: "/logo.svg",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0a09" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      suppressHydrationWarning
      className={`${bricolageGrotesque.variable} ${jetbrainsMono.variable}`}
    >
      <body className="antialiased bg-background text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
