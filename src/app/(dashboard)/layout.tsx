"use client";

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";

const ROLE_COLORS: Record<string, string> = {
  ADMIN: "#EA002C",
  MATERIALS: "#0078D4",
  PRODUCTION: "#00B96B",
  LOGISTICS: "#F7A600",
};

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  MATERIALS: "자재관리팀",
  PRODUCTION: "생산관리팀",
  LOGISTICS: "물류/인프라팀",
};

const NAV = [
  { group: "오늘의 운영", items: [
    { href: "/", label: "종합 현황" },
    { href: "/daily-control", label: "생산·자재 연동" },
  ] },
  { group: "자재·창고", items: [
    { href: "/inventory", label: "재고·보관일수" },
    { href: "/wms", label: "창고관리 (WMS)" },
  ] },
  { group: "생산 실행", items: [
    { href: "/mes", label: "공정 실행 (MES)" },
    { href: "/usage", label: "공정별 사용량" },
  ] },
  { group: "계획·시뮬레이션", items: [
    { href: "/simulation", label: "운영 What-if" },
    { href: "/market", label: "시장·수요 정보" },
  ] },
  { group: "분석·관리", items: [
    { href: "/value", label: "성과 관리" },
    { href: "/scm", label: "조달 기준" },
    { href: "/devlog", label: "개발 이력" },
  ] },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const user = session?.user as { name?: string; role?: string; department?: string } | undefined;
  const role = user?.role ?? "MATERIALS";
  const roleColor = ROLE_COLORS[role] ?? "#EA002C";

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    if (href === "/simulation") return pathname === "/simulation";
    return pathname.startsWith(href);
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-[228px] shrink-0 flex flex-col overflow-y-auto" style={{ backgroundColor: "var(--bg-sidebar)", borderRight: "1px solid var(--border)" }}>
        {/* 프로필 */}
        <div className="px-4 py-5" style={{ borderBottom: "1px solid var(--border)" }}>
          <div
            className="uppercase font-bold tracking-[0.08em] mb-1"
            style={{ fontSize: "11px", color: "var(--text-3)" }}
          >
            {user?.department ?? "자재관리팀"}
          </div>
          <div className="text-sm font-bold" style={{ color: "var(--text-1)", letterSpacing: "-0.01em" }}>
            {user?.name ?? "—"}
          </div>
          <span
            className="inline-block mt-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full text-white"
            style={{ backgroundColor: roleColor }}
          >
            {ROLE_LABELS[role] ?? role}
          </span>
        </div>

        {/* 네비게이션 */}
        <nav className="flex-1 py-2">
          {NAV.map(({ group, items }) => (
            <div key={group}>
              <div
                className="px-4 pt-4 pb-1 uppercase font-bold tracking-[0.08em]"
                style={{ fontSize: "11px", color: "var(--text-3)" }}
              >
                {group}
              </div>
              {items.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center mx-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    isActive(href)
                      ? "bg-[#FFF0F2] text-[#EA002C] font-bold"
                      : "hover:bg-[#F3F0EE]"
                  }`}
                  style={isActive(href) ? {} : { color: "var(--text-2)" }}
                >
                  {label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        {/* 푸터 */}
        <div className="px-4 py-3" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="mb-2" style={{ fontSize: "11px", color: "var(--text-3)" }}>이천 M14 / M16</div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-[#EA002C] bg-[#FFF0F2] hover:bg-[#FFD6DA] transition-colors"
          >
            로그아웃
          </button>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 헤더 */}
        <header
          className="h-[60px] flex items-center px-7 shrink-0"
          style={{ backgroundColor: "var(--bg-sidebar)", borderBottom: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-3">
            <Image src="/skhynix_logo.png" alt="SK hynix" width={100} height={28} className="h-7 w-auto" />
            <div className="w-px h-5" style={{ backgroundColor: "var(--border)" }} />
            <span
              className="uppercase font-bold tracking-[0.08em]"
              style={{ fontSize: "11px", color: "var(--text-3)" }}
            >
              FAB 자재관리
            </span>
          </div>
          <div className="ml-auto flex items-center gap-4">
            <div className="flex items-center gap-1.5 bg-[#E6FAF1] text-[#00875A] text-xs font-semibold px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00B96B] animate-pulse" />
              DATA CONNECTED
            </div>
            <span className="text-xs" style={{ color: "var(--text-3)" }}>이천 M14 / M16</span>
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
              style={{ backgroundColor: roleColor }}
            >
              {user?.name?.slice(0, 1) ?? "?"}
            </div>
          </div>
        </header>

        {/* 페이지 콘텐츠 */}
        <main className="flex-1 overflow-y-auto p-7" style={{ backgroundColor: "var(--bg-page)" }}>
          {children}
        </main>

        {/* 바텀 바 */}
        <div
          className="h-8 flex items-center px-6 gap-6 shrink-0"
          style={{
            backgroundColor: "var(--bg-page)",
            borderTop: "1px solid var(--border)",
            fontSize: "11px",
            color: "var(--text-3)",
          }}
        >
          <span className="text-[#00B96B] font-semibold">● 시스템 정상</span>
          <span style={{ color: "var(--border)" }}>|</span>
          <span>DB: MongoDB</span>
          <span style={{ color: "var(--border)" }}>|</span>
          <span>{new Date().toLocaleDateString("ko-KR")} 기준</span>
        </div>
      </div>
    </div>
  );
}
