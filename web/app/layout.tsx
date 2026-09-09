import type { Metadata } from "next";
import { Geist_Mono, Inter, Spectral } from "next/font/google";
import "./globals.css";
import { AppNav } from "@/components/AppNav";

/* The two typefaces of polariscollective.org: Spectral for the headings, Inter
   for the body. Geist Mono stays — the run identifiers, the JSON and the prompts
   need a fixed pitch, and the site has no equivalent. */

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const spectral = Spectral({
  variable: "--font-spectral",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Evals Playground",
  description: "Compose scenarios, run evaluations, read the results.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spectral.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppNav />
        {children}
      </body>
    </html>
  );
}
