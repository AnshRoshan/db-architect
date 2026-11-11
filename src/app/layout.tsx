import type { Metadata } from "next";
import type { ReactNode } from "react";
import Providers from "@/components/providers";
import { ErrorBoundary } from "@/components/error-boundary";
import "./globals.css";

export const metadata: Metadata = {
  title: "DB Architect — Database Architecture Intelligence",
  description: "Introspect, visualize, analyze, transform and migrate PostgreSQL, MySQL, SQLite and MongoDB schemas — and choose the right database for the workload.",
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
