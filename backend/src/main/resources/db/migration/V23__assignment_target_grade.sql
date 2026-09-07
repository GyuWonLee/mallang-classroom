-- V23: 과제 공개 대상 학년 (S15P11A407-143, 복식학급용).
--
-- V22 에서 '대상 학생'을 넣었는데, 복식학급(예: 1+3학년 한 반)에서는 "이 과제는 1학년만"처럼
-- 학년 단위로 공개하고 싶다. 학생을 일일이 고르지 않아도 되게 대상 '학년'을 함께 둔다.
--
-- 가시성 규칙(합집합): 학년·학생 대상이 둘 다 비면 학급 전체, 지정되면 학생의 학년이 대상 학년이거나
-- 본인이 대상 학생일 때 보인다. (Assignment.isVisibleTo 참고)

CREATE TABLE assignment_target_grade (
    assignment_id BIGINT   NOT NULL REFERENCES assignment (id),
    grade         SMALLINT NOT NULL,
    PRIMARY KEY (assignment_id, grade)
);
