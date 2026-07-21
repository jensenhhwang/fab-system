"use client";

import { useEffect, useRef, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, ROLE_COLOR, type DemoRole } from "@/lib/demo-accounts";
import Spinner from "./Spinner";

export default function RoleSwitcher() {
  const { data: session } = useSession();
  const router = useRouter();
  const user = session?.user as { name?: string; role?: DemoRole; department?: string } | undefined;
  const currentRole = user?.role ?? "MATERIALS";
  const roleColor = ROLE_COLOR[currentRole] ?? "#EA002C";

  const [open, setOpen] = useState(false);
  const [switchingEmail, setSwitchingEmail] = useState<string | null>(null);
  const [error, setError] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function switchTo(email: string) {
    setSwitchingEmail(email);
    setError("");
    const res = await signIn("credentials", { email, password: DEMO_PASSWORD, redirect: false });
    setSwitchingEmail(null);
    if (res?.error) {
      setError("전환에 실패했습니다.");
      return;
    }
    router.refresh();
    window.setTimeout(() => setOpen(false), 150);
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
        style={{ backgroundColor: roleColor }}
      >
        {user?.name?.slice(0, 1) ?? "?"}
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-2 w-[260px] rounded-xl bg-white z-50 overflow-hidden"
          style={{ border: "1px solid var(--border)", boxShadow: "var(--shadow-1)" }}
        >
          <div className="px-4 py-3 flex items-center gap-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
            <span
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
              style={{ backgroundColor: roleColor }}
            >
              {user?.name?.slice(0, 1) ?? "?"}
            </span>
            <div>
              <div className="text-sm font-bold" style={{ color: "var(--text-1)" }}>{user?.name ?? "—"}</div>
              <div style={{ fontSize: "10px", color: "var(--text-3)" }}>{user?.department ?? "—"}</div>
            </div>
          </div>

          <div className="px-4 pt-3 pb-1 uppercase font-bold tracking-[0.08em]" style={{ fontSize: "11px", color: "var(--text-3)" }}>
            역할 전환
          </div>
          <div className="pb-2">
            {DEMO_ACCOUNTS.map((acc) => {
              const isCurrent = acc.role === currentRole;
              const isSwitching = switchingEmail === acc.email;
              const isLocked = switchingEmail !== null && !isSwitching;
              return (
                <button
                  key={acc.email}
                  type="button"
                  disabled={isCurrent || switchingEmail !== null}
                  onClick={() => void switchTo(acc.email)}
                  className="w-[calc(100%-16px)] mx-2 my-0.5 px-3 py-2 rounded-lg flex items-center gap-2.5 text-left transition-colors disabled:cursor-default"
                  style={{
                    backgroundColor: isCurrent ? `${acc.color}14` : "transparent",
                    opacity: isLocked ? 0.4 : 1,
                  }}
                  onMouseEnter={(e) => { if (!isCurrent && switchingEmail === null) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--bg-page)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = isCurrent ? `${acc.color}14` : "transparent"; }}
                >
                  {isSwitching ? (
                    <Spinner size={18} color={acc.color} />
                  ) : (
                    <span
                      className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-white shrink-0"
                      style={{ backgroundColor: acc.color, fontSize: "8px", fontWeight: 700 }}
                    >
                      {acc.name.slice(0, 1)}
                    </span>
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>
                      {isSwitching ? "전환 중…" : `${acc.label} · ${acc.name}`}
                    </span>
                  </span>
                  {isCurrent && <span className="text-[10px] font-bold shrink-0" style={{ color: acc.color }}>현재</span>}
                </button>
              );
            })}
          </div>

          {error && (
            <div className="mx-2 mb-2 text-[10px] text-[#EA002C] bg-[#FFF0F2] rounded-lg px-2.5 py-1.5" style={{ border: "1px solid #FFD6DA" }}>
              {error}
            </div>
          )}

          <div className="px-2 pb-2" style={{ borderTop: "1px solid var(--border)" }}>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="w-full flex items-center justify-center gap-1.5 mt-2 py-2 rounded-lg text-xs font-semibold text-[#EA002C] bg-[#FFF0F2] hover:bg-[#FFD6DA] transition-colors"
            >
              로그아웃
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
