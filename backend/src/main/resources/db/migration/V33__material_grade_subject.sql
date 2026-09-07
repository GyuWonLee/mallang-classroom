-- V33: 학습자료에 학년·과목을 붙인다.
--
-- 과제 만들기에서 자료를 고를 때 학급의 자료가 **전부** 떴다. 1학년 과제를 만들려고 학년을
-- 골라도 6학년 자료가 그대로 목록에 남아, 비슷한 이름들 사이에서 무엇으로 문제를 만드는지
-- 선생님이 일일이 기억해야 했다. 무엇을 근거로 삼느냐가 결과를 좌우하는 자리다.
--
-- 둘 다 nullable 이다. 이미 올라간 자료에는 값이 없고, 값이 없는 자료는 "공용"으로 읽어
-- 어느 학년·과목에서도 고를 수 있게 한다 — 기존 자료가 목록에서 사라지면 그게 더 큰 사고다.
-- 앞으로 올리는 자료도 굳이 정하고 싶지 않으면 비워 둘 수 있다.
alter table material
    add column if not exists grade smallint,
    add column if not exists subject varchar(20);

-- 목록은 언제나 "이 학급의 자료"로 시작한다. 학년·과목은 그 안에서 좁히는 조건이라
-- 학급 인덱스에 얹어 둔다.
create index if not exists ix_material_classroom_grade
    on material (classroom_id, grade);
