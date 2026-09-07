-- V31: 수업에 학년을 붙인다 — 한 학급에서 학년별로 수업을 따로 돌리기 위해.
--
-- 지금까지 진행 중인 수업은 학급당 하나였다(session-already-open 409). 복식학급에서
-- 1학년은 A 선생님이, 3학년은 B 선생님이 동시에 수업하려면 그 전제가 성립하지 않는다.
--
-- nullable 인 이유: 이 열이 생기기 전에 만들어진 수업에는 학년이 없다. 그 행들은
-- "학급 전체 수업"으로 읽고, 애플리케이션이 같은 학급의 어떤 학년 수업과도 겹치지
-- 않게 막는다(SessionService.start).
alter table live_session
    add column if not exists grade smallint;

-- 진행 중인 수업은 (학급, 학년) 당 하나. 애플리케이션 가드가 이미 있지만 동시 요청 두 건이
-- 같은 순간에 통과하는 경합은 코드로 못 막는다 — 마지막 방어선을 DB 에 둔다.
--
-- `nulls not distinct` (PG15+) 가 핵심이다. 기본값인 nulls distinct 로 두면 학년 없는
-- 수업(= 학급 전체)이 여러 개 열려도 인덱스가 잡지 못한다.
create unique index if not exists ux_live_session_open_per_grade
    on live_session (classroom_id, grade) nulls not distinct
    where ended_at is null;
