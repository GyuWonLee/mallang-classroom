-- V18: AI 말랑이의 '제안 액션' (확인 후 실행).
--
-- 말랑이는 이미 "그건 선생님께 여쭤보자!"라고 말하도록 프롬프트에 적혀 있었지만, 말만 하고
-- 끝났다 — 아이가 직접 채팅으로 옮겨 가야 했다. 여기서 그 말에 실행을 붙인다.
--
-- 확인 후 실행인 이유: 사용자가 초등학생이다. AI 가 제안하고 아이가 '응'을 누른 뒤에만
-- 실제로 나간다. 무엇이 선생님에게 가는지 미리 보여줄 수 있어야 하므로 문장을 저장해 둔다.
--
-- JSON 대신 칼럼으로 펼친 이유: 액션이 둘뿐이고, V15 가 밝힌 목적(선생님이 무엇을 물었는지
-- 확인)에는 SQL 로 그냥 읽히는 편이 낫다. jsonb 를 쓰면 H2 테스트에서 도메인 매핑이 또 필요해진다.
ALTER TABLE ai_tutor_message
    ADD COLUMN action_type        VARCHAR(20),   -- ASK_TEACHER | SHOW_MATERIAL, NULL = 제안 없음
    ADD COLUMN action_status      VARCHAR(20),   -- PENDING | CONFIRMED | REJECTED
    ADD COLUMN action_title       VARCHAR(200),  -- ASK_TEACHER: 선생님에게 갈 제목
    ADD COLUMN action_content     TEXT,          -- ASK_TEACHER: 선생님에게 갈 본문
    ADD COLUMN action_material_id BIGINT,        -- SHOW_MATERIAL: 열어 줄 자료
    ADD COLUMN action_expires_at  TIMESTAMP;     -- 지나면 확인 불가 (아래 주석)

-- 자료가 지워져도 대화 기록은 남아야 한다(안전 확인 목적) — 그래서 FK 를 걸지 않고
-- 실행 시점에 '지금도 이 학급의 살아있는 자료인가'를 다시 확인한다.

-- 만료를 두는 이유: 어제 받은 제안을 오늘 눌러 질문이 선생님에게 가면 맥락이 어긋난다.
-- 24시간으로 잡았고, 만료 여부는 조회 시점에 판정한다(별도 배치를 두지 않는다 —
-- PENDING 인 채로 남은 행이 곧 '안 누른 제안'이라는 기록이기도 하다).

CREATE INDEX idx_ai_tutor_message_pending_action
    ON ai_tutor_message (student_id, action_status)
    WHERE action_status = 'PENDING';
