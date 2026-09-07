package com.mallang.classroom.service;

import com.mallang.classroom.dto.ClassroomDtos.CreateStudentRequest;
import com.mallang.global.error.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * 학생 일괄 등록 CSV 파서.
 * 형식: "이름,학교,학년[,학부모이메일]" (헤더 행은 있어도 되고 없어도 됨)
 * 4번째 열은 선택 — 비우면 계정 안내 메일 없이 종이 안내장만 나간다. 3열짜리 기존
 * 파일도 그대로 동작한다.
 * 인코딩: UTF-8(BOM 허용)과 CP949(한국어 엑셀 기본 저장 형식) 자동 인식.
 */
@Component
public class StudentCsvParser {

    private static final int MAX_ROWS = 100;

    // 엄밀한 RFC 검증이 아니라 오타를 거르는 용도다 — 실제 수신 여부는 보내 봐야 안다
    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");

    public List<CreateStudentRequest> parse(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "empty-csv", "CSV 파일이 비어 있습니다.");
        }
        String text = decode(readBytes(file));
        List<CreateStudentRequest> rows = new ArrayList<>();
        List<String> errors = new ArrayList<>();

        String[] lines = text.split("\\r?\\n");
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i].strip();
            if (line.isEmpty() || (i == 0 && isHeader(line))) {
                continue;
            }
            parseRow(line, i + 1, rows, errors);
        }
        if (!errors.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid-csv",
                    String.join(" / ", errors.subList(0, Math.min(errors.size(), 5))));
        }
        if (rows.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "empty-csv", "등록할 학생이 없습니다.");
        }
        if (rows.size() > MAX_ROWS) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "too-many-rows",
                    "한 번에 최대 %d명까지 등록할 수 있습니다. (요청: %d명)".formatted(MAX_ROWS, rows.size()));
        }
        return rows;
    }

    private void parseRow(String line, int lineNo, List<CreateStudentRequest> rows, List<String> errors) {
        String[] cols = line.split(",");
        if (cols.length < 3) {
            errors.add("%d행: '이름,학교,학년' 3개 열이 필요합니다".formatted(lineNo));
            return;
        }
        String name = unquote(cols[0]);
        String school = unquote(cols[1]);
        String gradeText = unquote(cols[2]);
        if (name.isBlank() || school.isBlank()) {
            errors.add("%d행: 이름/학교는 비울 수 없습니다".formatted(lineNo));
            return;
        }
        short grade;
        try {
            grade = Short.parseShort(gradeText);
        } catch (NumberFormatException e) {
            errors.add("%d행: 학년이 숫자가 아닙니다 (%s)".formatted(lineNo, gradeText));
            return;
        }
        if (grade < 1 || grade > 6) {
            errors.add("%d행: 학년은 1~6이어야 합니다 (%d)".formatted(lineNo, grade));
            return;
        }
        // 4번째 열은 선택. split 이 후행 빈 칸을 버리므로 길이로 확인한다 ("홍길동,말랑초,3," → 3칸)
        String parentEmail = cols.length >= 4 ? unquote(cols[3]) : "";
        if (!parentEmail.isBlank() && !EMAIL.matcher(parentEmail).matches()) {
            errors.add("%d행: 학부모 이메일 형식이 아닙니다 (%s)".formatted(lineNo, parentEmail));
            return;
        }
        rows.add(new CreateStudentRequest(name, school, grade,
                parentEmail.isBlank() ? null : parentEmail));
    }

    private boolean isHeader(String firstLine) {
        String lower = firstLine.toLowerCase();
        return lower.contains("이름") || lower.contains("name");
    }

    private String unquote(String value) {
        String v = value.strip();
        if (v.length() >= 2 && v.startsWith("\"") && v.endsWith("\"")) {
            v = v.substring(1, v.length() - 1);
        }
        return v.strip();
    }

    private byte[] readBytes(MultipartFile file) {
        try {
            return file.getBytes();
        } catch (IOException e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "unreadable-csv", "파일을 읽을 수 없습니다.");
        }
    }

    // UTF-8로 엄격 디코딩 시도 → 실패하면 CP949 (한국어 엑셀 저장 기본값)
    private String decode(byte[] bytes) {
        // UTF-8 BOM 제거
        if (bytes.length >= 3 && (bytes[0] & 0xFF) == 0xEF
                && (bytes[1] & 0xFF) == 0xBB && (bytes[2] & 0xFF) == 0xBF) {
            byte[] stripped = new byte[bytes.length - 3];
            System.arraycopy(bytes, 3, stripped, 0, stripped.length);
            bytes = stripped;
        }
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes)).toString();
        } catch (CharacterCodingException e) {
            return new String(bytes, Charset.forName("MS949"));
        }
    }
}
