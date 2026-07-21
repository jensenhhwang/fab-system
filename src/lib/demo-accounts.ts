export type DemoRole = "ADMIN" | "MATERIALS" | "PRODUCTION" | "LOGISTICS";

export type DemoAccount = {
  role: DemoRole;
  label: string;
  email: string;
  name: string;
  dept: string;
  color: string;
  summary: string;
  landingHref: string;
};

export const DEMO_PASSWORD = "fab1234!";

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { role: "ADMIN", label: "Admin", email: "admin@fab.skh", name: "황지훈", dept: "구매본부 자재관리팀", color: "#EA002C", summary: "전체 현황·리스크 관제", landingHref: "/" },
  { role: "MATERIALS", label: "자재관리팀", email: "materials@fab.skh", name: "김재현", dept: "구매본부 자재관리팀", color: "#0078D4", summary: "재고·DOH·입고 관리", landingHref: "/inventory" },
  { role: "PRODUCTION", label: "생산관리팀", email: "production@fab.skh", name: "이수진", dept: "생산관리팀", color: "#00B96B", summary: "공정별 사용량 조회", landingHref: "/mes" },
  { role: "LOGISTICS", label: "물류/인프라팀", email: "logistics@fab.skh", name: "박민준", dept: "물류/인프라팀", color: "#F7A600", summary: "입출고·창고 현황", landingHref: "/warehouse" },
];

export const ROLE_COLOR: Record<DemoRole, string> = Object.fromEntries(
  DEMO_ACCOUNTS.map((acc) => [acc.role, acc.color]),
) as Record<DemoRole, string>;

export const ROLE_LABEL: Record<DemoRole, string> = Object.fromEntries(
  DEMO_ACCOUNTS.map((acc) => [acc.role, acc.label]),
) as Record<DemoRole, string>;
