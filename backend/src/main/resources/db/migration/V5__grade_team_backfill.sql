-- V5: 팀 = 학급 내 같은 학년 자동 그룹 (기획 확정).
--     학년 팀 동시 생성 경합 방어 + 이미 등록된 학생을 학년 팀에 백필.

-- 같은 학급에 같은 학년 팀은 하나만 (soft delete 된 팀은 제외)
CREATE UNIQUE INDEX uq_team_classroom_grade
    ON team (classroom_id, grade)
    WHERE deleted_at IS NULL;

-- 기존 학생들의 (학급, 학년) 조합마다 팀 생성 — 이미 있으면 건너뜀
INSERT INTO team (classroom_id, name, grade, created_at)
SELECT s.classroom_id, s.grade::text || '학년', s.grade, now()
FROM (SELECT DISTINCT cm.classroom_id, u.grade
      FROM classroom_member cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.role = 'STUDENT'
        AND cm.deleted_at IS NULL
        AND u.deleted_at IS NULL
        AND u.grade IS NOT NULL) s
WHERE NOT EXISTS (SELECT 1 FROM team t
                  WHERE t.classroom_id = s.classroom_id
                    AND t.grade = s.grade
                    AND t.deleted_at IS NULL);

-- 기존 학생을 자기 학급의 학년 팀에 편입 — 이미 팀이 있는 학생은 건너뜀
INSERT INTO team_member (team_id, classroom_id, user_id, joined_at)
SELECT t.id, cm.classroom_id, cm.user_id, now()
FROM classroom_member cm
JOIN users u ON u.id = cm.user_id
JOIN team t ON t.classroom_id = cm.classroom_id
           AND t.grade = u.grade
           AND t.deleted_at IS NULL
WHERE cm.role = 'STUDENT'
  AND cm.deleted_at IS NULL
  AND u.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM team_member tm
                  WHERE tm.classroom_id = cm.classroom_id
                    AND tm.user_id = cm.user_id);
