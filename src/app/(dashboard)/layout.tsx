"use client";

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { ControlContextProvider, FabScopeControl } from "@/components/ControlContext";
import RoleSwitcher from "@/components/RoleSwitcher";
import LifeSignBadge from "@/components/LifeSignBadge";
import { ROLE_COLOR, ROLE_LABEL, type DemoRole } from "@/lib/demo-accounts";

const NAV = [
  { group: "오늘의 운영", items: [
    { href: "/", label: "관제탑 라이브" },
    { href: "/trends", label: "운영 트렌드" },
    { href: "/daily-control", label: "생산·자재 연동" },
  ] },
  { group: "자재·창고", items: [
    { href: "/inventory", label: "재고·보관일수" },
    { href: "/warehouse", label: "창고 Capacity" },
  ] },
  { group: "생산 실행", items: [
    { href: "/usage", label: "공정별 사용량" },
    { href: "/finished-goods", label: "완제품 재고" },
  ] },
  { group: "계획·시뮬레이션", items: [
    { href: "/erp-bridge", label: "계획·실행 브리지" },
    { href: "/simulation", label: "운영 What-if" },
    { href: "/procurement-cockpit", label: "입고 관제 (에이전트)" },
    { href: "/market", label: "시장·수요 정보" },
  ] },
  { group: "분석·관리", items: [
    { href: "/devlog", label: "개발 이력" },
  ] },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const user = session?.user as { name?: string; role?: DemoRole; department?: string } | undefined;
  const role = user?.role ?? "MATERIALS";
  const roleColor = ROLE_COLOR[role] ?? "#EA002C";

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    if (href === "/simulation") return pathname === "/simulation";
    if (href === "/inventory") return pathname === "/inventory" || pathname.startsWith("/inventory/materials/");
    return pathname.startsWith(href);
  }

  return (
    <ControlContextProvider>
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: "var(--bg-page)" }}>
      {/* ── Sidebar ── */}
      <aside className="w-[228px] shrink-0 flex flex-col overflow-y-auto" style={{ backgroundColor: "var(--bg-sidebar)", borderRight: "1px solid var(--border)" }}>
        {/* 프로필 */}
        <div className="px-4 pt-5 pb-4">
          <div className="rounded-[var(--radius-md)] px-3.5 py-3" style={{ backgroundColor: "var(--bg-card)", boxShadow: "var(--shadow-1)" }}>
            <div
              className="uppercase font-bold tracking-[0.09em] mb-1.5"
              style={{ fontSize: "10px", color: "var(--text-3)" }}
            >
              {user?.department ?? "자재관리팀"}
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="text-[13.5px] font-bold truncate" style={{ color: "var(--text-1)", letterSpacing: "-0.01em" }}>
                {user?.name ?? "—"}
              </div>
              <span
                className="shrink-0 text-[9.5px] font-bold px-2 py-0.5 rounded-full text-white tracking-[0.02em]"
                style={{ backgroundColor: roleColor }}
              >
                {ROLE_LABEL[role] ?? role}
              </span>
            </div>
          </div>
        </div>

        {/* 네비게이션 */}
        <nav className="flex-1 px-2 pb-2">
          {NAV.map(({ group, items }, groupIndex) => (
            <div key={group} className={groupIndex > 0 ? "mt-1" : ""}>
              <div
                className="px-2.5 pt-4 pb-1.5 uppercase font-bold tracking-[0.09em]"
                style={{ fontSize: "10px", color: "var(--text-4)" }}
              >
                {group}
              </div>
              <div className="space-y-0.5">
                {items.map(({ href, label }) => {
                  const active = isActive(href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      className="relative flex items-center pl-3.5 pr-3 py-[9px] rounded-[var(--radius-sm)] text-[13px] transition-colors"
                      style={{
                        color: active ? "var(--sk-red)" : "var(--text-2)",
                        fontWeight: active ? 700 : 500,
                        backgroundColor: active ? "var(--red-tint)" : "transparent",
                      }}
                      onMouseEnter={(e) => { if (!active) e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = "transparent"; }}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full" style={{ backgroundColor: "var(--sk-red)" }} />
                      )}
                      {label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* 푸터 */}
        <div className="px-4 py-3.5" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="mb-2.5 text-[10.5px]" style={{ color: "var(--text-3)" }}>이천 3FAB Campus · M20/21/22</div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-[var(--radius-sm)] text-[12px] font-bold transition-colors"
            style={{ color: "var(--sk-red)", backgroundColor: "var(--red-tint)" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#FFD9DE"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--red-tint)"; }}
          >
            로그아웃
          </button>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 헤더 */}
        <header
          className="h-[60px] flex items-center px-7 shrink-0 relative z-10"
          style={{ backgroundColor: "var(--bg-card)", boxShadow: "var(--shadow-1)" }}
        >
          <div className="flex items-center gap-3">
            <Image src="/skhynix_logo.png" alt="SK hynix" width={100} height={28} className="h-7 w-auto" />
            <div className="w-px h-5" style={{ backgroundColor: "var(--border)" }} />
            <span
              className="uppercase font-bold tracking-[0.09em]"
              style={{ fontSize: "10.5px", color: "var(--text-3)" }}
            >
              FAB 자재관리
            </span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <FabScopeControl />
            <LifeSignBadge />
            <span className="hidden text-[12px] xl:inline" style={{ color: "var(--text-3)" }}>이천 M20 / M21 / M22</span>
            <RoleSwitcher />
          </div>
        </header>

        {/* 페이지 콘텐츠 */}
        <main className="flex-1 overflow-y-auto p-7" style={{ backgroundColor: "var(--bg-page)" }}>
          {children}
        </main>

        {/* 바텀 바 */}
        <div
          className="h-8 flex items-center px-6 gap-4 shrink-0"
          style={{
            backgroundColor: "var(--bg-page)",
            borderTop: "1px solid var(--border)",
            fontSize: "10.5px",
            color: "var(--text-3)",
          }}
        >
          <LifeSignBadge variant="bar" />
          <span style={{ color: "var(--border)" }}>·</span>
          <span>DB: MongoDB</span>
          <span style={{ color: "var(--border)" }}>·</span>
          <span>{new Date().toLocaleDateString("ko-KR")} 기준</span>
        </div>
      </div>
    </div>
    </ControlContextProvider>
  );
}
