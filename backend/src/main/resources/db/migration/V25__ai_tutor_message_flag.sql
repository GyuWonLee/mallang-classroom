-- V25: 살펴봐야 할 대화 표시
--
-- 말랑이 시스템 프롬프트는 아이에게 "믿을 수 있는 어른과 나눠 줘"라고 말한다.
-- 그런데 어른에게 알리는 경로가 없었다. 복식학급은 교사 한 명이 여러 학년을 동시에 보고,
-- 담임이 20명의 대화를 매일 훑어보는 것은 비현실적이다. 아이가 털어놓은 말이 아무도
-- 읽지 않는 표에 쌓이기만 했다.
--
-- 답변은 그대로 나간다 — 아이 경험은 바뀌지 않는다. 바뀌는 것은 선생님 쪽 표시뿐이다.
-- 알림을 학생 이름의 쪽지로 보내지 않는 이유: 아이가 보내지 않은 말이 자기 이름으로
-- 담임에게 간 것처럼 남는다. 하필 아이가 털어놓은 내용이라 그건 더 나쁘다.

ALTER TABLE ai_tutor_message
    ADD COLUMN flagged     BOOLEAN      NOT NULL DEFAULT FALSE,
    ADD COLUMN flag_reason VARCHAR(50);

-- 학급별 "살펴볼 대화" 조회는 표시된 소수만 읽으면 되므로 부분 인덱스로 충분하다.
CREATE INDEX idx_ai_tutor_message_flagged
    ON ai_tutor_message (classroom_id, created_at DESC)
    WHERE flagged;
