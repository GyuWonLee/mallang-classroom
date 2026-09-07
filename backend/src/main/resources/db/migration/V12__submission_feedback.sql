-- V12: 과제 전체 AI 총평(학생용) 캐시 컬럼.
--
-- ai_analysis 와 자리를 나눈 이유: ai_analysis 는 명세상 '선생님용 리포트 해석'
-- (errorPattern·comment — api-spec §8, erd.md) 전용으로 예약된 칸이다. 한 칸을 나눠 쓰면
-- 리포트 기능이 구현되는 순간 학생용 총평을 통째로 덮어쓴다. 읽는 사람이 다르므로 칸도 나눈다.
--
-- 생성 시점은 '내 답안 다시보기' 첫 조회 — 명세 §8 이 aiAnalysis 에 쓰는 것과 같은
-- '온디맨드 + 캐시' 원칙이다. 재제출은 새 행이므로 시도마다 총평이 따로 남는다.
-- 기존 제출은 NULL 로 시작하고, 학생이 다시 열 때 채워진다.

ALTER TABLE submission ADD COLUMN feedback TEXT;
