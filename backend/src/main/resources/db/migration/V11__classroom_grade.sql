-- V11: 학급이 담당하는 학년 (1~2개). 학생 등록 시 이 학년만 허용한다.
-- V10 은 S15P11A407-114(제출·리포트) 브랜치가 선점하고 있어 V11 을 쓴다.

CREATE TABLE classroom_grade (
    classroom_id BIGINT   NOT NULL REFERENCES classroom (id),
    grade        SMALLINT NOT NULL,

    PRIMARY KEY (classroom_id, grade),
    CONSTRAINT classroom_grade_range_check CHECK (grade BETWEEN 1 AND 6)
);

-- 기존 학급 백필: 소속 학생들의 학년을 그대로 담당 학년으로 삼는다.
-- 학년이 3개 이상 섞인 학급은 "최대 2개" 규칙과 맞지 않으므로 비워 둔다.
-- (비어 있으면 제약을 걸지 않는다 — 선생님이 학급 수정에서 정하면 그때부터 적용)
INSERT INTO classroom_grade (classroom_id, grade)
SELECT g.classroom_id, g.grade
FROM (SELECT cm.classroom_id, u.grade
      FROM classroom_member cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.role = 'STUDENT'
        AND cm.deleted_at IS NULL
        AND u.deleted_at IS NULL
        AND u.grade IS NOT NULL
      GROUP BY cm.classroom_id, u.grade) g
WHERE (SELECT count(DISTINCT u2.grade)
       FROM classroom_member cm2
       JOIN users u2 ON u2.id = cm2.user_id
       WHERE cm2.classroom_id = g.classroom_id
         AND cm2.role = 'STUDENT'
         AND cm2.deleted_at IS NULL
         AND u2.deleted_at IS NULL
         AND u2.grade IS NOT NULL) <= 2;
