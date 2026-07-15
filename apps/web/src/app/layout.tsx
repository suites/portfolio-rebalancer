import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";

import "@portfolio-rebalancer/ui/styles.css";
import "./shell.css";

export const metadata: Metadata = {
  title: "Portfolio Rebalancer",
  description: "장기 목표 비중을 안전하게 관리하는 개인용 자산배분 시스템",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={GeistSans.className}>
      <body>{children}</body>
    </html>
  );
}
