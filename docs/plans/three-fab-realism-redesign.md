# M20·M21·M22 3-Fab 현실성 재설계

> **M20 기준 승계:** 이 문서의 M20 `50,000 WSPM` 가정은 2026-07-19부터 [`../fab-master.md`](../fab-master.md)의 `FAB_MASTER_M20_V1`로 대체되었다. M21·M22 값은 아직 `TBD / NOT_MODELED`이며 실제 생산능력으로 해석하지 않는다.

상태: `2026 학습 시나리오 v1` 승인 · 2026-07-15

## 1. 왜 다시 설계하는가

기존 시스템에는 서로 양립할 수 없는 규모가 섞여 있었다.

- 시장 화면의 장비 병목 모델: 캠퍼스 전체 약 19.2K WSPM
- 일일 생산 데모: HBM 12K + DRAM 18K + NAND 15K wafer/day, 월 환산 1.35M
- `processUsage`: Fab 생산능력과 wafer당 원단위가 아니라 절대 월사용량과 임의 배율로 구성
- 재고: 구매 ROP 기간 수요를 전부 현장재고로 간주

따라서 생산량, 자재 사용량, 재고일수, 창고 Capacity와 3D 외형이 같은 공장을 설명하지 못했다. 현실성 재설계 전에는 기존 수치를 운영 기준으로 확정하지 않는다.

## 2. 외부 기준과 시나리오 가정

확인된 외부 기준:

- SEMI는 2026년 전 세계 300mm 메모리 생산능력을 월 410만 웨이퍼로 전망한다.
- SK hynix M16 공식 공개 외형은 건축면적 57,000m², 336m × 163m × 105m이다.
- Intel은 전형적인 대형 Fab이 약 1,200개의 생산 장비와 1,500개의 유틸리티 장비를 포함한다고 설명한다.

아래 제품별 시장 분모와 Fab 생산능력은 외부 확정 통계가 아니라 학습 모델용 가정이다. 모든 화면에서 `wafer-equivalent 설계비중`과 `2026-PLAN-V1`을 표시한다. 매출점유율, bit 점유율 또는 HBM 완제품 점유율로 표현하지 않는다.

| Fab | 제품 역할 | 명목 WSPM | 가동률 | wafer yield | 유효 WSPM | 가정 시장 분모 | 설계비중 | 설계 외곽치 |
|---|---|---:|---:|---:|---:|---:|---:|---|
| M20 | HBM용 DRAM base die + TSV 연계 | 50,000 | 90% | 85% | 38,250 | 450,000 | 8.5% | 330 × 160 × 105m |
| M21 | 범용 DRAM | 80,000 | 92% | 90% | 66,240 | 1,550,000 | 4.3% | 360 × 180 × 105m |
| M22 | 3D NAND | 100,000 | 90% | 88% | 79,200 | 2,100,000 | 3.8% | 400 × 200 × 105m |

캠퍼스 합계는 명목 230K WSPM, 유효 약 183.7K WSPM이다. 410만 WSPM 메모리 기준 유효 wafer-equivalent 비중은 약 4.5%다.

## 3. 계산의 단일 기준

생산과 자재는 다음 순서로 유도한다.

`Fab 명목 WSPM → 가동률 → 일일 wafer starts → 공정 방문수 → wafer당 자재 원단위 → 재작업계수 → 일사용량`

수율은 양품 wafer-equivalent와 시장 설계비중 계산에 적용한다. 자재 투입량은 공정 투입 시점의 wafer starts를 사용하므로 완제품 수율로 단순 축소하지 않는다.

HBM 완제품 공급량은 후속 단계에서 다음 요소를 추가한 뒤 계산한다.

`양품 wafer × good die/wafer ÷ stack die 수 × 적층·패키징 수율`

## 4. 재고와 물류 경계

- 공용 중앙창고: 입고, 검사, 격리, 중앙 reserve, 빈용기 회수
- Fab 로컬창고: M20·M21·M22에 할당된 단기 재고
- 라인사이드: 1~3일 working stock과 자동전환 캐비닛
- VMI/외부창고: 공급사 소유 또는 캠퍼스 외부 reserve
- 운송중: 확정됐지만 물리 점유에 포함되지 않는 재고

구매 리드타임 수요를 전부 현장에 저장하지 않는다. `현장 + VMI + 확정입고 + 운송중` 재고포지션이 리드타임을 커버한다.

초기 현장재고 범위의 v1 가정:

- 벌크가스·연속공급: 0.5~2일, 탱크 레벨 관리
- 벌크 케미컬: 3~7일
- 특수가스: 7~14일
- 포토레지스트·전구체: 현장 5~10일, 초과분은 VMI/외부창고
- 일반 소모품: 14~30일

모든 stocked 자재는 안전재고보다 크거나 같고 현장 상한보다 작거나 같아야 한다. `capacityLimit`를 재고량에 맞춰 자동 증액하지 않는다. 물리 Capacity가 현장재고를 제한한다.

## 5. PRS와 물리 모델

단일 `PRS-01` 좌표를 다음 구조로 분리한다.

- 중앙 PRS: 입고검사, 격리, 중앙 reserve, 회수용기
- M20-PRS, M21-PRS, M22-PRS: 각 Fab의 1~3일 공급 버퍼

슬롯과 외형은 Fab별 자재 사용량이 재산출된 뒤 결정한다. 3D에서는 독립 건물, 랙/캐비닛 모듈, footprint, 클릭 영역, 카메라 framing, 배관 시작점을 같은 Capacity 마스터에서 유도한다.

## 6. 구현 단계

1. 완료: 시나리오 기준서와 버전형 Fab 규모 마스터
2. 진행: Market 화면에서 3-Fab 명목/유효 WSPM과 설계비중 표시
3. 기존 시뮬레이터와 데모가 LIVE 재고를 변경하지 못하도록 환경 격리
4. `fabId`가 필수인 제품·공정·원단위 마스터 도입
5. M20/M21/M22별 자재 사용량 재생성
6. 중앙/VMI/운송중/Fab 로컬/라인사이드 재고 모델 분리
7. 현장 상·하한과 물리 Capacity 동시 산정
8. Lot·HU·집계재고가 동일한 새 opening balance 생성
9. 3-Fab과 중앙/로컬 창고·PRS를 3D에 배치
10. 시간 흐름, 입출고, MES 소비 에이전트 연결

## 7. 데이터 전환 원칙

- 현실성 기준 없이 적용했던 ROP opening 재고 배치는 롤백했다.
- 기존 12개 스케일업 계획은 새 원단위가 확정되기 전까지 실행하지 않는다.
- 과소·과다재고는 새 기준에서 함께 재산출한다.
- 새 opening balance는 원본 snapshot, 배치 ID, 역조정 절차를 보유한다.
- 전환 완료 조건은 `Lot 합계 = HU 합계 = 집계재고`다.

## 8. 공개 근거

- SEMI, 300mm memory capacity 4.1M WPM in 2026: https://www.semi.org/en/semi-press-release/semi-projects-300mm-memory-equipment-investment-to-surpass-50-billion-dollars-in-2026
- SEMI, global 300mm capacity outlook: https://www.semi.org/en/semi-press-release/semi-forecasts-69-percent-growth-in-advanced-chipmaking-capacity-through-2028-due-to-ai
- SK hynix M16 completion and dimensions: https://news.skhynix.com/sk-hynix-announces-the-completion-of-m16-plant-construction/
- Intel, typical Fab equipment and structure: https://newsroom.intel.com/tech101/how-a-semiconductor-factory-works
