-- V20: 종료 처리가 안 된 채 남은 수업을 닫는다.
--
-- 배경: LiveKit 은 방이 비면 empty_timeout(기본 5분) 후 room_finished 웹훅을 보낸다.
-- 실제로 154번 보냈다. 그런데 LiveKitWebhookController 가 participant 가 없는 이벤트를
-- 첫 검사에서 버리고 있었고(room_finished 에는 participant 필드가 없다), 그래서 수업은
-- 선생님이 "수업 종료"를 명시적으로 누를 때만 닫혔다. 브라우저만 닫으면 영원히 열린
-- 채로 남는다. 적용 시점에 14개가 그 상태였고 가장 오래된 것은 8일째였다.
--
-- 웹훅 구멍은 같은 MR 에서 막았다. 이 마이그레이션은 이미 쌓인 것을 정리한다.
--
-- 기준: 마지막 참가자 활동으로부터 6시간이 지난 수업만 닫는다. 지금 진행 중일 수도 있는
-- 수업을 배포가 끊는 일이 없어야 하기 때문이다. 최근 것들은 남겨두고, 그 방이 닫힐 때
-- 새 웹훅 경로가 자연히 종료 처리한다.
--
-- ended_at 은 마지막 참가자 활동 시각으로 잡는다. now() 로 채우면 8일짜리 수업이
-- 이력에 남아 통계가 왜곡된다.

WITH abandoned AS (
    SELECT s.id,
           COALESCE(
               max(GREATEST(p.joined_at, COALESCE(p.left_at, p.joined_at))),
               s.started_at
           ) AS last_activity
    FROM live_session s
    LEFT JOIN session_participant p ON p.session_id = s.id
    WHERE s.ended_at IS NULL
    GROUP BY s.id, s.started_at
    HAVING COALESCE(
               max(GREATEST(p.joined_at, COALESCE(p.left_at, p.joined_at))),
               s.started_at
           ) < now() - interval '6 hours'
)
UPDATE live_session s
SET ended_at = a.last_activity
FROM abandoned a
WHERE s.id = a.id;

-- 닫힌 수업에 "아직 안 나간" 참가자가 남아 있으면 출석 기록이 어긋난다.
-- 퇴장 시각을 수업 종료 시각으로 맞춘다.
UPDATE session_participant p
SET left_at = s.ended_at
FROM live_session s
WHERE p.session_id = s.id
  AND s.ended_at IS NOT NULL
  AND p.left_at IS NULL;
