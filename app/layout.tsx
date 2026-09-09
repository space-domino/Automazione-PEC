import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Domain Reselling Platform",
  // La dashboard non va indicizzata. Le landing pubbliche (M7) sovrascriveranno questo.
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
