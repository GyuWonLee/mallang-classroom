-- V28: 학부모 이메일
--
-- 학생 계정은 아이디·임시 비밀번호를 종이 안내장으로만 전달했다. 저학년일수록 종이는
-- 잃어버리고, 그러면 선생님이 초기화해 다시 뽑아 줘야 했다. 학부모 메일로도 함께 보내면
-- 집에 사본이 남는다.
--
-- 선생님에게는 이 칸이 없다 — username 이 곧 이메일이다.
-- NULL 을 허용한다: 이메일을 주지 않는 가정이 있고, 그때는 기존대로 종이 안내장만 나간다.
ALTER TABLE users
    ADD COLUMN parent_email VARCHAR(255);

-- grade 와 같은 방식으로 역할별 무결성을 못 박는다 (users_role_grade_check 와 짝).
-- 학생은 있어도 없어도 되지만, 선생님에게 값이 들어가는 것은 실수다.
ALTER TABLE users
    ADD CONSTRAINT users_role_parent_email_check CHECK (
        role = 'STUDENT' OR parent_email IS NULL
    );
