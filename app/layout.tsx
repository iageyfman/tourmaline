import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Tourmaline",
  description: "Personal linked-notes app",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="h-full">{children}</body>
    </html>
  );
}
