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

  function fillAccount(acc: typeof DEMO_ACCOUNTS[0]) {
    setEmail(acc.email);
    setPassword("fab1234!");
    setError("");
  }

  return (
    <div className="min-h-screen bg-[#F4F4F4] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* 로고 헤더 */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E8E8E8] p-8 mb-4">
          <div className="flex items-center gap-3 mb-8">
            <Image src="/skhynix_logo.png" alt="SK hynix" width={120} height={32} className="h-8 w-auto" />
            <div className="w-px h-5 bg-[#E8E8E8]" />
            <span className="text-xs text-[#999] font-medium tracking-wide">FAB 자재관리</span>
          </div>

          <div className="mb-6">
            <h1 className="text-xl font-extrabold text-[#111] mb-1">로그인</h1>
            <p className="text-sm text-[#999]">이천 M14/M16 자재관리 시스템</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#555] mb-1.5">이메일</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@fab.skh"
                required
                className="w-full px-3.5 py-2.5 text-sm border border-[#E8E8E8] rounded-lg outline-none focus:border-[#EA002C] focus:ring-2 focus:ring-[#EA002C]/10 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#555] mb-1.5">비밀번호</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호 입력"
                required
                className="w-full px-3.5 py-2.5 text-sm border border-[#E8E8E8] rounded-lg outline-none focus:border-[#EA002C] focus:ring-2 focus:ring-[#EA002C]/10 transition-all"
              />
            </div>

            {error && (
              <div className="text-xs text-[#EA002C] bg-[#FFF0F2] border border-[#FFD6DA] rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#EA002C] text-white text-sm font-bold py-2.5 rounded-lg hover:bg-[#c8002a] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? "로그인 중…" : "로그인"}
            </button>
          </form>
        </div>

        {/* 데모 계정 */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E8E8E8] p-5">
          <p className="text-xs font-semibold text-[#999] uppercase tracking-widest mb-3">데모 계정 (비밀번호: fab1234!)</p>
          <div className="grid grid-cols-2 gap-2">
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.email}
                onClick={() => fillAccount(acc)}
                className="text-left p-3 rounded-xl border border-[#F0F0F0] hover:border-[#E8E8E8] hover:bg-[#F8F8F8] transition-all group"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white"
                    style={{ backgroundColor: acc.color }}
                  >
                    {acc.label}
                  </span>
                </div>
                <div className="text-xs font-semibold text-[#111]">{acc.name}</div>
                <div className="text-[10px] text-[#999] mt-0.5">{acc.dept}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
