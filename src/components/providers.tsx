"use client";

import { ThemeProvider } from "next-themes";
import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";
import SessionSync from "@/components/session-sync";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange={false}>
      <MotionConfig reducedMotion="user"><SessionSync />{children}</MotionConfig>
    </ThemeProvider>
  );
}
