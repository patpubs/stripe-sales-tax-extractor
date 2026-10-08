import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sales Tax Report",
  description: "Sales by state from your Stripe accounts",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
