-- V14: 수업 밖 1:1 메시지 + 읽음 상태 (명세 §11.1 #3·#4).
--
-- 지금까지 CHAT_MESSAGE 는 '수업 중 학생→선생님' 전용이었다. session_id 가 NOT NULL 이라
-- 교사끼리의 대화는 저장할 자리가 아예 없었고(#3), 읽음 상태 컬럼이 없어 선생님 9 화면의
-- "안 읽은 것이 위" 정렬도 만들 수 없었다(#4).
--
-- 바꾸는 방향은 "학급이 대화의 문맥이고, 수업은 선택"이다:
--   session_id  NULL 허용  → 수업 밖 대화가 성립한다
--   classroom_id NOT NULL  → 모든 대화에 학급 문맥이 남는다 (권한 검증의 기준)
--   recipient_id NULL 허용 → 1:1 대화에서 받는 사람. 수업 채팅은 대기열이 라우팅하므로 비운다
--   read_at                → 수신자가 읽은 시각. recipient_id 가 있는 1:1 대화에서만 의미가 있다

ALTER TABLE chat_message ADD COLUMN classroom_id BIGINT REFERENCES classroom (id);

-- 기존 행은 전부 수업에 속해 있으므로 수업의 학급을 그대로 물려받는다
UPDATE chat_message m
SET classroom_id = s.classroom_id
FROM live_session s
WHERE m.session_id = s.id;

ALTER TABLE chat_message ALTER COLUMN classroom_id SET NOT NULL;
ALTER TABLE chat_message ALTER COLUMN session_id DROP NOT NULL;

ALTER TABLE chat_message ADD COLUMN recipient_id BIGINT REFERENCES users (id);
ALTER TABLE chat_message ADD COLUMN read_at TIMESTAMP;

-- 스레드 목록: "나에게 온 것 중 안 읽은 것"을 세고, 상대별 마지막 메시지를 찾는다
CREATE INDEX idx_chat_message_recipient
    ON chat_message (recipient_id, read_at, created_at DESC);
-- 상대와의 대화 조회 (학급 문맥 안에서 양방향)
CREATE INDEX idx_chat_message_direct
    ON chat_message (classroom_id, sender_id, recipient_id, created_at);
