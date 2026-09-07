-- V22: 과제 공개 대상 학생 (S15P11A407-143).
--
-- 그동안 과제는 발행하면 학급 '전체'에게 보였다. 오답 클리닉처럼 특정 학생을 위한 과제도
-- 전체에 공개돼 버렸다. 이제 과제마다 대상 학생을 지정할 수 있게 한다:
--   - 대상 행이 하나도 없으면(빈 값) → 지금처럼 학급 전체 공개(하위호환)
--   - 대상 행이 있으면 → 그 학생들에게만 목록·열람·제출을 허용
--
-- 접근 제어의 축이라 (assignment_id, student_id) 를 PK 로 두고, 학생 기준 조회(내 과제 목록)를
-- 위해 student_id 인덱스를 둔다.

CREATE TABLE assignment_target (
    assignment_id BIGINT NOT NULL REFERENCES assignment (id),
    student_id    BIGINT NOT NULL REFERENCES users (id),
    PRIMARY KEY (assignment_id, student_id)
);

CREATE INDEX idx_assignment_target_student ON assignment_target (student_id);
