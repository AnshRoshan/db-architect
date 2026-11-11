import type { Metadata } from "next";
import type { ReactNode } from "react";
import Providers from "@/components/providers";
import { ErrorBoundary } from "@/components/error-boundary";
import "./globals.css";

export const metadata: Metadata = {
  title: "DB Architect — Database Architecture Intelligence",
  description: "Map every schema and every database your system runs on — PostgreSQL, MySQL, SQLite, MongoDB and Redis — then analyze, transform, migrate and choose the right engine.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <Providers><ErrorBoundary>{children}</ErrorBoundary></Providers>
      </body>
    </html>
  );
}
