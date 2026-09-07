-- V7: 업로드 파일 (ERD UPLOADED_FILE) — 학생 녹음·TTS 음성·판서 이미지·학습자료 PDF의 원본

CREATE TABLE uploaded_file (
    -- 외부 식별자라 UUID: 순번이면 /api/files/1/content 부터 훑어볼 수 있다 (이 테이블만 UUID)
    id            UUID         PRIMARY KEY,
    uploader_id   BIGINT       NOT NULL REFERENCES users (id),
    purpose       VARCHAR(30)  NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    -- 서버 내부 저장 경로 키. 실제 절대 경로는 설정(mallang.media.root)과 조합한다
    storage_key   VARCHAR(255) NOT NULL UNIQUE,
    content_type  VARCHAR(100) NOT NULL,
    size_bytes    BIGINT       NOT NULL,
    created_at    TIMESTAMP    NOT NULL
);

CREATE INDEX idx_uploaded_file_uploader ON uploaded_file (uploader_id);
