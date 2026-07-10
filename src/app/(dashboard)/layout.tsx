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
  { group: "Dashboard",   items: [{ href: "/",           icon: "📊", label: "종합 현황" }] },
  { group: "창고 관리",   items: [{ href: "/warehouse",  icon: "🏭", label: "창고 Capacity" }] },
  {
    group: "자재 분석",
    items: [
      { href: "/inventory", icon: "📦", label: "재고·보관일수",   badge: "alert" },
      { href: "/usage",     icon: "📈", label: "공정별 사용량" },
      { href: "/product",   icon: "💿", label: "제품별 사용량" },
      { href: "/simulation",icon: "🧮", label: "입고 시뮬레이션" },
    ],
  },
  {
    group: "인프라·SCM",
    items: [
      { href: "/infra",  icon: "🔧", label: "교체주기 관리",   badge: "infra" },
      { href: "/scm",    icon: "🌐", label: "공급망 가시성" },
    ],
  },
  {
    group: "리스크·협업",
    items: [
      { href: "/risk",   icon: "⚠️",  label: "리스크 관리",   badge: "risk" },
      { href: "/collab", icon: "🤝", label: "유관부서 이슈" },
    ],
  },
  { group: "기록",        items: [{ href: "/wiki",       icon: "📝", label: "업무 일지" }] },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const user = session?.user as { name?: string; role?: string; department?: string } | undefined;
  const role = user?.role ?? "MATERIALS";
  const roleColor = ROLE_COLORS[role] ?? "#EA002C";

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-[228px] shrink-0 bg-white border-r border-[#E8E8E8] flex flex-col overflow-y-auto">
        {/* 프로필 */}
        <div className="px-4 py-5 border-b border-[#F0F0F0]">
          <div className="text-[10px] text-[#999] uppercase tracking-wider mb-1">{user?.department ?? "자재관리팀"}</div>
          <div className="text-sm font-bold text-[#111]">{user?.name ?? "—"}</div>
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
              <div className="px-4 pt-4 pb-1 text-[10px] text-[#999] uppercase tracking-widest font-semibold">
                {group}
              </div>
              {items.map(({ href, icon, label }) => (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-2.5 mx-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    isActive(href)
                      ? "bg-[#FFF0F2] text-[#EA002C] font-bold"
                      : "text-[#555] hover:bg-[#F8F8F8] hover:text-[#111]"
                  }`}
                >
                  <span className="text-base leading-none">{icon}</span>
                  <span>{label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>

        {/* 푸터 */}
        <div className="px-4 py-3 border-t border-[#F0F0F0]">
          <div className="text-[11px] text-[#999] leading-relaxed">이천 M14 / M16</div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="mt-2 text-[11px] text-[#999] hover:text-[#EA002C] transition-colors"
          >
            로그아웃
          </button>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 헤더 */}
        <header className="h-[60px] bg-white border-b border-[#E8E8E8] flex items-center px-7 shrink-0">
          <div className="flex items-center gap-3">
            <Image src="/skhynix_logo.png" alt="SK hynix" width={100} height={28} className="h-7 w-auto" />
            <div className="w-px h-5 bg-[#E8E8E8]" />
            <span className="text-xs text-[#999] font-medium">FAB 자재관리</span>
          </div>
          <div className="ml-auto flex items-center gap-4">
            <div className="flex items-center gap-1.5 bg-[#E6FAF1] text-[#00875A] text-xs font-semibold px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00B96B] animate-pulse" />
              LIVE
            </div>
            <span className="text-xs text-[#999]">이천 M14 / M16</span>
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
              style={{ backgroundColor: roleColor }}
            >
              {user?.name?.slice(0, 1) ?? "?"}
            </div>
          </div>
        </header>

        {/* 페이지 콘텐츠 */}
        <main className="flex-1 overflow-y-auto p-7">{children}</main>

        {/* 바텀 바 */}
        <div className="h-8 bg-[#FAFAFA] border-t border-[#E8E8E8] flex items-center px-6 gap-6 text-[11px] text-[#999] shrink-0">
          <span className="text-[#00B96B] font-semibold">● 시스템 정상</span>
          <span className="text-[#E8E8E8]">|</span>
          <span>DB: SQLite (로컬)</span>
          <span className="text-[#E8E8E8]">|</span>
          <span>{new Date().toLocaleDateString("ko-KR")} 기준</span>
        </div>
      </div>
    </div>
  );
}
