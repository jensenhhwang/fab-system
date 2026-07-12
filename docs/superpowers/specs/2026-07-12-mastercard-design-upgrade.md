# FAB 시스템 디자인 업그레이드 — Mastercard 디자인 언어 적용

**날짜:** 2026-07-12  
**범위:** 전체 시스템 (B안 — 표면 레이어 + 주요 카드/컴포넌트)  
**레퍼런스:** `DESIGN-mastercard.md`

---

## 1. 변경 목표

기존 쿨 그레이(`#F4F4F4`) 기반의 평범한 대시보드를 **warm cream 캔버스 + editorial 타이포** 조합으로 업그레이드한다. SK하이닉스 CI(`#EA002C`)와 기능적 시맨틱 컬러는 유지하고, 분위기와 밀도감만 한 층 높인다.

---

## 2. 토큰 시스템

### 배경/서피스

| 토큰 | 기존 | 변경 | 설명 |
|------|------|------|------|
| `--bg-page` | `#F4F4F4` | `#F3F0EE` | Canvas Cream — warm putty 배경 |
| `--bg-card` | `#FFFFFF` | `#FFFFFF` | 유지 — cream 위의 lifted 효과 |
| `--bg-section` | 없음 | `#FCFBFA` | Lifted Cream — 중첩 서피스 |
| `--border` | `#E8E8E8` | `#E5E1DD` | Warm toned border |
| `--bg-sidebar` | `#FFFFFF` | `#FAFAF9` | Sidebar warm off-white |

### 텍스트

| 토큰 | 기존 | 변경 | 설명 |
|------|------|------|------|
| `--text-1` | `#111111` | `#141413` | Ink Black (살짝 따뜻함) |
| `--text-2` | `#555555` | `#555555` | 유지 |
| `--text-3` | `#999999` | `#696969` | Slate Gray |

### 브랜드/시맨틱 (모두 유지)

| 토큰 | 값 |
|------|-----|
| `--sk-red` | `#EA002C` |
| `--sk-orange` | `#F47725` |
| `--green` | `#00B96B` |
| `--yellow` | `#F7A600` |
| `--blue` | `#0078D4` |

### 그림자 (신규)

| 레벨 | 값 | 용도 |
|------|-----|------|
| `--shadow-1` | `rgba(0,0,0,0.04) 0px 4px 24px` | 카드, 로그인 패널 |

---

## 3. 타이포그래피

**폰트:** Pretendard Variable (CDN)  
**Fallback:** `'Apple SD Gothic Neo', 'Malgun Gothic', -apple-system, sans-serif`

### 계층

| 역할 | 크기 | Weight | Letter-spacing |
|------|------|--------|----------------|
| 페이지 H1 | 24px | 700 | -0.025em |
| 카드 수치 | 28–32px | 700 | -0.02em |
| Eyebrow 라벨 | 11px | 700 | +0.08em / uppercase |
| Body | 14px | 400 | normal |
| 테이블 헤더 | 11px | 700 | +0.06em / uppercase |

---

## 4. 컴포넌트별 변경

### Sidebar
- 배경: `#FAFAF9`
- Nav 그룹 라벨: eyebrow 스타일
- Active 링크: `bg-[#FFF0F2] text-[#EA002C]` 유지
- Hover: `hover:bg-[#F3F0EE]`
- 이모지 아이콘 제거 (텍스트 레이블만)

### Header
- 배경: `#FAFAF9`
- "FAB 자재관리" 텍스트: eyebrow 스타일
- Border: `#E5E1DD`

### Bottom Bar
- 배경: `#F3F0EE` (페이지 배경과 연결)
- Border: `#E5E1DD`

### KPI 카드 (대시보드)
- Shadow: Level 1 (`rgba(0,0,0,0.04) 0px 4px 24px`)
- Border: `#E5E1DD`
- 라벨: eyebrow 스타일
- 수치: `font-weight: 700`, `letter-spacing: -0.02em`

### 테이블
- 헤더: eyebrow 스타일 (11px / 700 / uppercase / +0.06em)
- Stripe: `#F3F0EE` (canvas cream)
- Border: `#E5E1DD`

### 로그인 페이지
- 배경: `#F3F0EE`
- 카드 Shadow: Level 1
- 버튼: `#EA002C` 유지

---

## 5. Do / Don't

**Do**
- Canvas Cream `#F3F0EE`을 모든 페이지 배경에 사용
- H1/H2에 `-0.02em` 이상 tight letter-spacing 적용
- Eyebrow 라벨은 항상 uppercase + wide tracking

**Don't**
- 이모지를 UI 아이콘으로 사용 (제거)
- `#EA002C`를 consent/법적 용도 이외에 남발 (기존처럼 액센트로만)
- 새 shadow를 48px spread 미만으로 tight하게 쓰기

---

## 6. 변경 파일 목록

1. `src/app/globals.css`
2. `src/app/(dashboard)/layout.tsx`
3. `src/app/(dashboard)/page.tsx`
4. `src/app/(dashboard)/inventory/InventoryClient.tsx`
5. `src/app/(dashboard)/usage/UsageClient.tsx`
6. `src/app/login/page.tsx`
