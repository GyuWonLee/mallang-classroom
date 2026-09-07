-- V16: 학급 alias 유니크 제약을 '살아있는 학급'으로 한정.
--
-- 문제: Classroom 엔티티에 @SQLRestriction("deleted_at is null")이 걸려 있어
-- AliasGenerator 의 existsByAlias() 가 삭제된 학급의 alias 를 보지 못한다. 반면
-- classroom_alias_key 제약은 삭제 여부와 무관하게 전 행을 덮는다. 그래서 생성기는
-- "비어 있다"고 판단한 alias 로 INSERT 했다가 유니크 위반으로 500 을 냈다.
-- 적용 시점 기준 풀 35 단어 중 21 개가 삭제된 학급에 묶여 있어, 학급 생성 성공률이
-- 약 12% 까지 떨어져 있었다 (선생님이 버튼을 여러 번 눌러야 만들어지는 증상).
--
-- 해결: 제약을 부분 유니크 인덱스로 바꿔 DB 를 엔티티의 관점(삭제된 학급은 없는 것)에
-- 맞춘다. 삭제된 학급이 쥐고 있던 alias 가 다시 배정 가능해진다.
--
-- 학생 username 충돌은 생기지 않는다 — StudentAccountIssuer 가
-- countByUsernamePrefixIncludingDeleted() 로 삭제된 계정까지 세어 번호를 이어가므로,
-- bitna 를 재사용해도 bitna01 이 아니라 그 다음 번호부터 발급된다.
--
-- 블루-그린 안전성: 제약을 '완화'하는 방향이라 전환 중 잠시 함께 도는 구버전도
-- 그대로 동작한다 (확장-수축 규칙의 확장 단계에 해당).

ALTER TABLE classroom DROP CONSTRAINT IF EXISTS classroom_alias_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_classroom_alias_live
    ON classroom (alias) WHERE deleted_at IS NULL;
