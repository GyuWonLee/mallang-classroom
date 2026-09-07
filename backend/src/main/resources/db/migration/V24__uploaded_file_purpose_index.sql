-- V24: uploaded_file 용도·생성시각 인덱스
--
-- TTS 음성이 콘텐츠 주소화(storage_key = sha256(namespace+voice+text))로 바뀌면서
-- 같은 문장은 한 행만 남는다. 그래도 "용도별로 얼마나 쌓였나 / 오래된 것이 무엇인가"를
-- 물어보는 운영 질의가 전체 스캔이 되지 않도록 인덱스를 둔다.
--
-- storage_key 의 UNIQUE 인덱스는 V7 에서 이미 만들어졌고, 중복 합성을 막는 조회는
-- 그 인덱스를 탄다 — 여기서 다시 만들지 않는다.

CREATE INDEX IF NOT EXISTS idx_uploaded_file_purpose_created
    ON uploaded_file (purpose, created_at);
