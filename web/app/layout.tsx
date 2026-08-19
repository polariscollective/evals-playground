import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <nav className="border-b px-8 py-3 flex gap-6 text-sm">
          <Link href="/" className="font-medium">
            Evaluate
          </Link>
          <Link href="/runs" className="font-medium">
            Runs
          </Link>
          <Link href="/creer" className="font-medium">
            Create
          </Link>
          <Link href="/scenarios" className="font-medium">
            Scenarios
          </Link>
          <Link href="/juges" className="font-medium">
            Judges
          </Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
