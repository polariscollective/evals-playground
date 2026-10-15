import type { Metadata } from "next";
import { Bricolage_Grotesque, IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { getSessionAccess, getSessionEmail } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { ReaderOnly } from "@/components/ReaderOnly";
import { PATH_HEADER, pageAllowed } from "@/lib/visibility";

/* The framework's three faces. Bricolage Grotesque carries the headings and the
   mark's wordmark, Instrument Sans the body and the interface, IBM Plex Mono
   everything that is data: run identifiers, timestamps, scores, model names,
   diffs, table numerics. Mono is never used for prose or for a label. */

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  weight: ["400", "600"],
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Evals Playground",
  description: "Compose scenarios, run evaluations, read the results.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // A restricted reader may sign in, but the application itself is for
  // members: every page but a shared run, its log and the sign-in screen is
  // replaced by one saying so. The API refuses them on its own (`requireUser`).
  const path = (await headers()).get(PATH_HEADER);
  const allowed = path === null || pageAllowed(await getSessionAccess(), path);
  return (
    <html
      lang="en"
      className={`${instrumentSans.variable} ${bricolage.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {allowed ? (
          <AppShell>{children}</AppShell>
        ) : (
          <ReaderOnly email={await getSessionEmail()} />
        )}
      </body>
    </html>
  );
}
