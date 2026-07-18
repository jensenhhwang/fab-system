import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "next-auth/react";

export const metadata: Metadata = {
  title: "FAB 자재관리 시스템 — SK하이닉스 이천",
  description: "이천 3FAB Campus · M20/M21/M22 자재관리 시스템",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="h-full antialiased" style={{ colorScheme: "light", backgroundColor: "#F3F0EE" }}>
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css"
        />
      </head>
      <body className="h-full" style={{ backgroundColor: "#F3F0EE", color: "#141413" }}>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
