import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Micro-SaaS Factory",
  description:
    "Clone the template, replace the tokens, ship a micro-SaaS. Factory dashboard for creating, listing and pricing products.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
