# 팀 컨벤션 (A407)

> 모든 컨벤션의 연결고리는 **Jira 이슈 키**다 (예: `S15P11A407-45`).
> 이슈 키는 브랜치명 → 커밋 → MR을 관통하며, GitLab-Jira 연동 시 이슈 화면에 자동 표시된다.

## 1. Jira 운영

### 이슈 계층

```
Epic   = 기능 축 (회원/인증, 학급/팀, 실시간 수업, 과제/AI, 채팅, 인프라)
Story  = 사용자 관점 가치 단위 — "선생님은 학급을 생성할 수 있다"
Task   = 구현 단위 — "Classroom 엔티티/리포지토리 구현", "학급 생성 API"
```

### 운영 규칙

- 스프린트는 1주 단위 (월요일 플래닝 → 금요일 회고)
- **이슈 없는 작업 금지** — 코드를 짜려면 반드시 이슈부터 만든다
- Story에는 인수 조건(Acceptance Criteria)을 적는다: "~하면 ~된다" 형태 2~3줄
- 담당자(Assignee)는 항상 1명 — 공동 담당 금지

## 2. Git 브랜치 전략

```
master   ← 배포 브랜치 (Jenkins 자동 배포 대상)
develop  ← 통합 브랜치 (MR의 목적지)
feature/S15P11A407-45-classroom-create   ← 작업 브랜치
fix/S15P11A407-72-invite-expire-bug
```

- 브랜치명: `{part}/{type}/{Jira키}-{짧은-영문-설명}`
- part: `front` / `back`
- type: `feature` / `fix` / `hotfix` / `docs` / `chore`
- `master`, `develop` 직접 push 금지 (GitLab protected branch로 강제)

## 3. 커밋 메시지

형식: `type: 제목 (Jira키)`

```
feat: 학급 생성 API 구현 (S15P11A407-45)

- ClassroomMember OWNER 자동 등록 포함
- 학급명 중복 검증 추가
```

- 제목: 한글, 50자 이내, 명령조("구현", "추가", "수정")
- type은 7개만 사용: `feat` `fix` `refactor` `test` `docs` `chore` `style`
- 본문(선택): 무엇을/왜 위주로 불릿 정리
- 스마트 커밋(`#done` 등)은 사용하지 않는다 — 이슈 상태는 Jira에서 직접 변경

## 4. MR(Merge Request)

- 제목은 커밋과 동일 형식: `feat: 학급 생성 API (S15P11A407-45)`
- **최소 1명 approve 후 머지, 셀프 머지 금지**
- MR은 작게 — 변경 300~500줄을 넘기면 쪼갠다
- 머지 방식: **squash merge** (develop 히스토리 = MR 1개당 커밋 1개)
- 템플릿: 변경 내용 / 테스트 방법 / 관련 이슈

## 5. 코드 컨벤션

> 원칙: 도구로 강제되는 것만 정한다. 문서로만 존재하는 컨벤션은 지켜지지 않는다.

### Backend (Java)

- 포맷터: IntelliJ 설정 공유 (`.editorconfig` + formatter xml 저장소 포함)
- 네이밍: 클래스 `PascalCase`, 메서드/변수 `camelCase`, 상수 `UPPER_SNAKE_CASE`
- 패키지: 도메인 기준 (`user`, `classroom`, `team`, `session`, `assignment`, `chat`, `ai`, `global`)

### Frontend (React + TS)

- Oxlint + Prettier, 저장 시 자동 포맷 (`npm run lint`로 검사)
- 컴포넌트 파일: `PascalCase` (`ClassroomList.tsx`), 훅: `use~` (`useClassroom.ts`)

### API 네이밍 (REST)

- 리소스는 복수 명사: `/api/classrooms/{id}/members`
- URL에 동사 금지, URL은 `kebab-case`, JSON 필드는 `camelCase`

## 6. 추후 결정 사항

- [ ] develop 머지 조건에 CI(Jenkins 빌드) 통과 필수 걸기 — Jenkins 세팅 후
- [ ] GitLab-Jira 연동 설정 (이슈 키 자동 링크)
