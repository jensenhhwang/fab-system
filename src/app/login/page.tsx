"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, type DemoAccount } from "@/lib/demo-accounts";
import Spinner from "@/components/Spinner";

export default function LoginPage() {
  const [switchingEmail, setSwitchingEmail] = useState<string | null>(null);
  const [error, setError] = useState("");
  const router = useRouter();

  async function selectRole(acc: DemoAccount) {
    setSwitchingEmail(acc.email);
    setError("");
    const res = await signIn("credentials", { email: acc.email, password: DEMO_PASSWORD, redirect: false });
    if (res?.error) {
      setSwitchingEmail(null);
      setError("전환에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } else {
      router.push(acc.landingHref);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: "var(--bg-page)" }}>
      <div className="w-full max-w-lg">
        {/* 로고 헤더 */}
        <div
          className="bg-white rounded-2xl p-8 mb-4"
          style={{ boxShadow: "var(--shadow-1)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-3 mb-8">
            <Image src="/skhynix_logo.png" alt="SK hynix" width={120} height={32} className="h-8 w-auto" />
            <div className="w-px h-5" style={{ backgroundColor: "var(--border)" }} />
            <span
              className="uppercase font-bold tracking-[0.08em]"
              style={{ fontSize: "11px", color: "var(--text-3)" }}
            >
              FAB 자재관리
            </span>
          </div>

          <div>
            <h1 className="text-xl font-bold mb-1" style={{ color: "var(--text-1)", letterSpacing: "-0.02em" }}>역할을 선택하세요</h1>
            <p className="text-sm" style={{ color: "var(--text-3)" }}>이천 3FAB Campus · M20/M21/M22 자재관리 시스템</p>
          </div>
        </div>

        {/* 역할 선택 */}
        <div
          className="bg-white rounded-2xl p-5"
          style={{ boxShadow: "var(--shadow-1)", border: "1px solid var(--border)" }}
        >
          {error && (
            <div className="text-xs text-[#EA002C] bg-[#FFF0F2] rounded-lg px-3 py-2 mb-3" style={{ border: "1px solid #FFD6DA" }}>
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {DEMO_ACCOUNTS.map((acc) => {
              const isSwitching = switchingEmail === acc.email;
              const isLocked = switchingEmail !== null && !isSwitching;
              return (
                <button
                  key={acc.email}
                  onClick={() => void selectRole(acc)}
                  disabled={switchingEmail !== null}
                  className="text-left p-5 rounded-2xl transition-all group disabled:cursor-not-allowed"
                  style={{
                    border: "1px solid var(--border)",
                    backgroundColor: "transparent",
                    opacity: isLocked ? 0.4 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (switchingEmail !== null) return;
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--bg-page)";
                    (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)";
                    (e.currentTarget as HTMLButtonElement).style.boxShadow = "var(--shadow-1)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
                    (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
                    (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
                  }}
                >
                  {isSwitching ? (
                    <div className="flex items-center gap-2 py-3">
                      <Spinner size={14} color={acc.color} />
                      <span className="text-xs font-bold" style={{ color: acc.color }}>이동 중…</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                          style={{ backgroundColor: acc.color }}
                        >
                          {acc.name.slice(0, 1)}
                        </span>
                        <span
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white uppercase tracking-[0.04em]"
                          style={{ backgroundColor: acc.color }}
                        >
                          {acc.label}
                        </span>
                      </div>
                      <div className="text-sm font-bold" style={{ color: "var(--text-1)" }}>{acc.name}</div>
                      <div style={{ fontSize: "10px", color: "var(--text-3)", marginTop: "2px" }}>{acc.dept}</div>
                      <div className="text-[11px] mt-1" style={{ color: "var(--text-2)" }}>{acc.summary}</div>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
