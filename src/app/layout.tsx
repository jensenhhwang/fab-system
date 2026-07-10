import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "next-auth/react";

export const metadata: Metadata = {
  title: "FAB 자재관리 시스템 — SK하이닉스 이천",
  description: "이천 M14/M16 FAB 자재관리 시스템",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="h-full bg-[#F4F4F4] text-[#111]">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
