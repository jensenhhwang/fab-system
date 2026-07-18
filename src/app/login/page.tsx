"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";

const DEMO_ACCOUNTS = [
  { label: "ADMIN", email: "admin@fab.skh", name: "황지훈", dept: "구매본부 자재관리팀", color: "#EA002C" },
  { label: "자재관리팀", email: "materials@fab.skh", name: "김재현", dept: "구매본부 자재관리팀", color: "#0078D4" },
  { label: "생산관리팀", email: "production@fab.skh", name: "이수진", dept: "생산관리팀", color: "#00B96B" },
  { label: "물류/인프라팀", email: "logistics@fab.skh", name: "박민준", dept: "물류/인프라팀", color: "#F7A600" },
];

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      setError("이메일 또는 비밀번호가 올바르지 않습니다.");
    } else {
      router.push("/");
    }
  }

  async function fillAccount(acc: typeof DEMO_ACCOUNTS[0]) {
    setLoading(true);
    setError("");
    const res = await signIn("credentials", { email: acc.email, password: "fab1234!", redirect: false });
    setLoading(false);
    if (res?.error) {
      setEmail(acc.email);
      setPassword("fab1234!");
      setError("로그인에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } else {
      router.push("/");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: "var(--bg-page)" }}>
      <div className="w-full max-w-md">
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

          <div className="mb-6">
            <h1 className="text-xl font-bold mb-1" style={{ color: "var(--text-1)", letterSpacing: "-0.02em" }}>로그인</h1>
            <p className="text-sm" style={{ color: "var(--text-3)" }}>이천 3FAB Campus · M20/M21/M22 자재관리 시스템</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold mb-1.5 uppercase tracking-[0.06em]" style={{ color: "var(--text-2)" }}>이메일</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@fab.skh"
                required
                className="w-full px-3.5 py-2.5 text-sm rounded-lg outline-none transition-all"
                style={{
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--bg-page)",
                  color: "var(--text-1)",
                }}
                onFocus={(e) => { e.target.style.borderColor = "#EA002C"; e.target.style.boxShadow = "0 0 0 3px rgba(234,0,44,0.08)"; }}
                onBlur={(e) => { e.target.style.borderColor = "var(--border)"; e.target.style.boxShadow = "none"; }}
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1.5 uppercase tracking-[0.06em]" style={{ color: "var(--text-2)" }}>비밀번호</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호 입력"
                required
                className="w-full px-3.5 py-2.5 text-sm rounded-lg outline-none transition-all"
                style={{
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--bg-page)",
                  color: "var(--text-1)",
                }}
                onFocus={(e) => { e.target.style.borderColor = "#EA002C"; e.target.style.boxShadow = "0 0 0 3px rgba(234,0,44,0.08)"; }}
                onBlur={(e) => { e.target.style.borderColor = "var(--border)"; e.target.style.boxShadow = "none"; }}
              />
            </div>

            {error && (
              <div className="text-xs text-[#EA002C] bg-[#FFF0F2] rounded-lg px-3 py-2" style={{ border: "1px solid #FFD6DA" }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full text-white text-sm font-bold py-2.5 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ backgroundColor: "#EA002C" }}
              onMouseEnter={(e) => { if (!loading) (e.target as HTMLButtonElement).style.backgroundColor = "#c8002a"; }}
              onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.backgroundColor = "#EA002C"; }}
            >
              {loading ? "로그인 중…" : "로그인"}
            </button>
          </form>
        </div>

        {/* 데모 계정 */}
        <div
          className="bg-white rounded-2xl p-5"
          style={{ boxShadow: "var(--shadow-1)", border: "1px solid var(--border)" }}
        >
          <p
            className="uppercase font-bold tracking-[0.08em] mb-3"
            style={{ fontSize: "11px", color: "var(--text-3)" }}
          >
            데모 계정 (비밀번호: fab1234!)
          </p>
          <div className="grid grid-cols-2 gap-2">
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.email}
                onClick={() => fillAccount(acc)}
                className="text-left p-3 rounded-xl transition-all group"
                style={{ border: "1px solid var(--border)", backgroundColor: "transparent" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--bg-page)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white uppercase tracking-[0.04em]"
                    style={{ backgroundColor: acc.color }}
                  >
                    {acc.label}
                  </span>
                </div>
                <div className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>{acc.name}</div>
                <div style={{ fontSize: "10px", color: "var(--text-3)", marginTop: "2px" }}>{acc.dept}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
