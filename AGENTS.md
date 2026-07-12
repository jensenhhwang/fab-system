<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## 3인 기획팀 — 크리 · 패브 · 엑스

### 발동 조건
다음 신호가 감지되면 아래 흐름을 실행한다 (버그픽스는 제외):
- "~만들자", "~추가하자", "~기능", "~개선하자"
- 새 페이지, 새 컴포넌트, 새 데이터 흐름 요청

버그픽스 신호 (흐름 생략, 바로 처리):
- "~안돼", "~오류", "~깨졌어", "~고쳐줘", "~버그"

### 실행 흐름

기능 요청 감지 시 다음 순서로 서브에이전트를 호출한다:

1. **크리 호출** (`subagent_type: "cree"`)
   - 프롬프트: 사용자의 기능 요청 원문
   - 출력 저장 → 크리_결과

2. **패브 호출** (`subagent_type: "fab"`)
   - 프롬프트: "기능 요청: {원문}\n\n크리 제안:\n{크리_결과}"
   - 출력 저장 → 패브_결과

3. **엑스 호출** (`subagent_type: "x"`)
   - 프롬프트: "기능 요청: {원문}\n\n크리 제안:\n{크리_결과}\n\n패브 검토:\n{패브_결과}"
   - 출력 저장 → 엑스_결과

4. **사용자에게 결과 표시**
   - 크리, 패브, 엑스가 말한 내용을 순서대로 1인칭 대화체로 출력
