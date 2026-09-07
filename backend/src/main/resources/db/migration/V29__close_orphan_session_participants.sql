-- V29: 닫히지 않은 출석 행 정리
--
-- 출석은 "재입장 = 새 행"으로 이력을 남기고, leave 웹훅이 열린 행 하나를 닫는 구조다.
-- 두 지점에서 행이 열린 채 남았다:
--
--   1) 회선이 불안정하면 ICE 재연결이 반복된다(실측: 90분에 한 사람이 80회). join 웹훅은
--      매번 오지만 leave 는 유실될 수 있어, 같은 사람의 열린 행이 여러 개 쌓였다.
--   2) 수업이 끝나도 남은 행을 닫는 처리가 없었다. 종료된 수업의 참가자가 영원히
--      "접속 중"으로 조회됐다.
--
-- 두 구멍은 같은 MR 의 코드 변경으로 막았다(입장 시 기존 열린 행 마감, 종료 시 일괄 마감).
-- 이 마이그레이션은 그 전에 이미 쌓인 것을 되돌린다. 측정 시점 기준 종료된 수업 3건,
-- 진행 중 수업의 중복 2건.

-- ① 같은 (수업, 사용자)의 열린 행이 여럿이면 가장 최근 것만 남긴다.
--    이전 행은 다음 입장 시각으로 닫는다 — 그 순간 이전 접속은 이미 끝나 있었다.
UPDATE session_participant sp
SET left_at = latest.joined_at
FROM (
    SELECT session_id, user_id, MAX(joined_at) AS joined_at
    FROM session_participant
    WHERE left_at IS NULL
    GROUP BY session_id, user_id
) latest
WHERE sp.left_at IS NULL
  AND sp.session_id = latest.session_id
  AND sp.user_id = latest.user_id
  AND sp.joined_at < latest.joined_at;

-- ② 이미 끝난 수업에 남아 있는 행은 수업 종료 시각으로 닫는다.
--    출석 시간이 수업 길이를 넘지 않게 하려는 것이다. ended_at 보다 늦게 들어온 행은
--    있을 수 없지만, 혹시 있어도 joined_at 으로 닫아 음수 구간이 생기지 않게 한다.
UPDATE session_participant sp
SET left_at = GREATEST(s.ended_at, sp.joined_at)
FROM live_session s
WHERE sp.session_id = s.id
  AND sp.left_at IS NULL
  AND s.ended_at IS NOT NULL;
