package com.mallang.file.dto;

import com.mallang.file.entity.UploadedFile;

/** 파일 도메인 DTO — 프론트 services/api/fileApi.ts 와 shape 일치 */
public class FileDtos {

    /**
     * 업로드 결과. fileId 는 UUID 문자열 — 프론트 UploadResult.fileId 는 string 이어야 한다
     * (명세 §9 예시의 숫자 id 는 ERD 의 UUID 결정보다 앞선 서술이라 ERD 를 따른다).
     */
    public record UploadResponse(String fileId, String url) {

        public static UploadResponse from(UploadedFile file) {
            String id = file.getId().toString();
            return new UploadResponse(id, "/api/files/" + id + "/content");
        }
    }
}
