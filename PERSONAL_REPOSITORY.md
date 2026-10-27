# 개인 저장소 안내

SSAFY A407 팀 프로젝트 **말랑교실**의 소스 보관본입니다. 개인 단독 개발 프로젝트가 아니며, 원본 README의 팀원 및 역할을 유지합니다.

- 원본: https://lab.ssafy.com/s15-webmobile1-sub1/S15P11A407
- 기준: `master`, `dc6dfd86f6b747d4d3d4606a40905aee0e6ea57a`
- 과거 커밋에 남은 민감정보의 재전송을 방지하기 위해 새 Git 이력으로 시작합니다.

## 업로드에서 제외한 항목

환경 파일 전체(`.env*`), DB 덤프를 포함한 `exec/`, 실제 운영 서버 설정(`infra/server/`), 서버 접속·운영 인수인계 문서, Jenkins 설정, GitLab 템플릿, 주차별 개인 자료와 회고를 제외했습니다. DB 스키마 마이그레이션과 애플리케이션·테스트 소스는 보존합니다.

운영 도메인은 `classroom.example.com`으로 치환했습니다. 문서의 해당 도메인은 예시이며 실행 가능한 서비스 주소가 아닙니다. 기본 DB 비밀번호와 JWT 서명키는 제거하여 환경변수 주입을 요구합니다. 로컬 DB/Redis 포트는 127.0.0.1에만 바인딩합니다.

## 로컬 실행

Java 17, Node.js 및 Docker가 필요합니다. 아래 설정은 로컬에서만 생성하고 커밋하지 마세요.

1. 터미널 환경변수에 `DB_PASSWORD`와 임의의 32바이트 이상 `JWT_SECRET`을 설정합니다. 두 값은 직접 생성하세요. Spring Boot는 `.env` 파일을 자동으로 읽지 않으므로 실행 프로세스 환경에 전달해야 합니다.
2. 저장소 루트에서 `docker compose -f infra/docker-compose.local.yml up -d`를 실행합니다.
3. `backend`에서 `./gradlew bootRun` (Windows: `./gradlew.bat bootRun`)을 실행합니다.
4. `frontend`에서 `npm ci`, `npm run dev`를 실행합니다.

프론트엔드 API 기본 경로는 `/api`이고 개발 프록시는 `localhost:8080`을 사용합니다. 필요하면 `VITE_API_BASE_URL`, `API_PROXY_TARGET`, `WS_PROXY_TARGET`을 별도 지정하세요. 화상 기능에는 별도로 준비한 LiveKit 서버와 `LIVEKIT_PUBLIC_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`이 필요합니다. AI·메일 기능의 키와 SMTP 인증정보도 각자의 환경에서 주입합니다.

## 보안 점검 범위

업로드 파일에 대해 Gitleaks 및 설정 검토를 수행했습니다. 자동 탐지된 두 항목은 비밀번호 생성용 문자 목록과 테스트 전용 LiveKit 문자열로 확인했습니다. 실제 인증정보가 아니므로 테스트와 생성 코드를 보존합니다. 업로드 대상의 비밀정보 점검이며, 애플리케이션 전체의 취약점 감사나 운영 보안 보증은 아닙니다.

## 원본 대조 확인 (2026-10-27)

GitLab master `13c3ca581c9ecaad0ffd21ec9e2eb2ff39e48ca5`와 README를 제외하고 파일 목록과 내용을 대조했다. backend/frontend 기능 소스와 DB 마이그레이션은 보존되어 있으며, 차이는 운영 주소의 예시 치환, 환경변수 요구, 로컬 프록시 및 API 기본 경로 설정이다. 개인 자료·회고, 운영 인프라·인수인계, 환경 파일과 DB 덤프는 제외 상태를 유지한다. 원본의 민감정보 삭제 MR도 반영된 상태를 확인했다.
