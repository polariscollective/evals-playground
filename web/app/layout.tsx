import type { Metadata } from "next";
import { Geist_Mono, Inter, Spectral } from "next/font/google";
import "./globals.css";
import { AppNav } from "@/components/AppNav";

/* Les deux polices de polariscollective.org : Spectral pour les titres, Inter
   pour le corps. Geist Mono reste — les identifiants de run, le JSON et les
   invites ont besoin d'une chasse fixe, et le site n'a pas d'équivalent. */

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
