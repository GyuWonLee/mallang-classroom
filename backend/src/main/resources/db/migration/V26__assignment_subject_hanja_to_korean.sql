-- V24: 과목에서 한자(HANJA) 제거 — 남아 있던 HANJA 과제를 KOREAN 으로 이관 (S15P11A407-145).
--
-- 과목을 국영수사과 5개로 재정의하며 HANJA 를 enum 에서 뺐다. enum 값이 사라지면 기존 HANJA 행을
-- 로드할 때 역직렬화가 깨지므로, 남아 있을 수 있는 행을 먼저 KOREAN 으로 옮긴다(없으면 무해).
UPDATE assignment SET subject = 'KOREAN' WHERE subject = 'HANJA';
