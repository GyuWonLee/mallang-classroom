package com.mallang.classroom.service;

import com.mallang.classroom.dto.ClassroomDtos.CreateStudentRequest;
import com.mallang.global.error.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 학생 명단 CSV 파싱.
 *
 * <p>선생님이 엑셀에서 저장해 올리는 파일이라 손을 탄 입력이 그대로 들어온다 — 인코딩,
 * 헤더 유무, 따옴표, 빈 줄, 잘못된 학년. 여기서 막지 못하면 학급 생성이 통째로 롤백되거나
 * (createClassroomWithStudents 는 한 트랜잭션이다) 깨진 이름의 계정이 발급된다.</p>
 */
class StudentCsvParserTest {

    private final StudentCsvParser parser = new StudentCsvParser();

    @Test
    void parsesNameSchoolGrade() {
        List<CreateStudentRequest> rows = parser.parse(utf8("""
                김민수,말랑초등학교,2
                이영희,말랑초등학교,3
                """));

        assertThat(rows).hasSize(2);
        assertThat(rows.get(0).name()).isEqualTo("김민수");
        assertThat(rows.get(0).school()).isEqualTo("말랑초등학교");
        assertThat(rows.get(0).grade()).isEqualTo((short) 2);
    }

    @Test
    void parsesOptionalParentEmailColumn() {
        List<CreateStudentRequest> rows = parser.parse(utf8("""
                김민수,말랑초등학교,2,parent@example.com
                """));

        assertThat(rows.get(0).parentEmail()).isEqualTo("parent@example.com");
    }

    @Test
    void threeColumnFilesStillWork() {
        // 기존 명단 파일이 그대로 올라와야 한다 — 이메일 열은 나중에 생긴 것이다
        List<CreateStudentRequest> rows = parser.parse(utf8("김민수,말랑초등학교,2"));

        assertThat(rows.get(0).parentEmail()).isNull();
    }

    @Test
    void blankParentEmailBecomesNull() {
        // 엑셀에서 일부만 채우면 이런 줄이 나온다 (후행 쉼표)
        List<CreateStudentRequest> rows = parser.parse(utf8("김민수,말랑초등학교,2,"));

        assertThat(rows.get(0).parentEmail()).isNull();
    }

    @Test
    void rejectsMalformedParentEmailWithLineNumber() {
        assertThatThrownBy(() -> parser.parse(utf8("김민수,말랑초등학교,2,parent-at-example.com")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("1행")
                .hasMessageContaining("학부모 이메일");
    }

    @Test
    void skipsTheHeaderRowWhenPresent() {
        List<CreateStudentRequest> rows = parser.parse(utf8("""
                이름,학교,학년
                김민수,말랑초등학교,2
                """));

        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).name()).isEqualTo("김민수");
    }

    @Test
    void headerIsOptional() {
        assertThat(parser.parse(utf8("김민수,말랑초등학교,2"))).hasSize(1);
    }

    @Test
    void readsExcelSavedCp949Files() {
        // 한국어 엑셀의 기본 저장 형식이다 — UTF-8만 받으면 실사용에서 이름이 깨진다
        byte[] cp949 = "김민수,말랑초등학교,2".getBytes(Charset.forName("MS949"));
        List<CreateStudentRequest> rows = parser.parse(new MockMultipartFile(
                "students", "students.csv", "text/csv", cp949));

        assertThat(rows.get(0).name()).isEqualTo("김민수");
        assertThat(rows.get(0).school()).isEqualTo("말랑초등학교");
    }

    @Test
    void stripsUtf8ByteOrderMark() {
        byte[] withBom = new byte[]{(byte) 0xEF, (byte) 0xBB, (byte) 0xBF};
        byte[] body = "김민수,말랑초등학교,2".getBytes(StandardCharsets.UTF_8);
        byte[] all = new byte[withBom.length + body.length];
        System.arraycopy(withBom, 0, all, 0, withBom.length);
        System.arraycopy(body, 0, all, withBom.length, body.length);

        // BOM 을 안 떼면 첫 이름 앞에 보이지 않는 문자가 붙은 채로 계정이 발급된다
        assertThat(parser.parse(new MockMultipartFile("s", "s.csv", "text/csv", all))
                .get(0).name()).isEqualTo("김민수");
    }

    @Test
    void unquotesQuotedCells() {
        List<CreateStudentRequest> rows = parser.parse(utf8("\"김민수\",\"말랑초등학교\",\"2\""));

        assertThat(rows.get(0).name()).isEqualTo("김민수");
        assertThat(rows.get(0).grade()).isEqualTo((short) 2);
    }

    @Test
    void ignoresBlankLines() {
        List<CreateStudentRequest> rows = parser.parse(utf8("""
                김민수,말랑초등학교,2

                이영희,말랑초등학교,3
                """));

        // 엑셀은 마지막에 빈 줄을 잘 남긴다 — 그걸 오류로 만들면 정상 파일이 거절된다
        assertThat(rows).hasSize(2);
    }

    @Test
    void reportsTheLineNumberOfABadGrade() {
        assertThatThrownBy(() -> parser.parse(utf8("""
                김민수,말랑초등학교,2
                이영희,말랑초등학교,열
                """)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("2행")
                .hasMessageContaining("숫자가 아닙니다");
    }

    @Test
    void gradeMustBeWithinElementarySchool() {
        assertThatThrownBy(() -> parser.parse(utf8("김민수,말랑초등학교,7")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("1~6");
    }

    @Test
    void missingColumnsAreReported() {
        assertThatThrownBy(() -> parser.parse(utf8("김민수,말랑초등학교")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("3개 열");
    }

    @Test
    void blankNameOrSchoolIsRejected() {
        assertThatThrownBy(() -> parser.parse(utf8(",말랑초등학교,2")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("비울 수 없습니다");
    }

    @Test
    void reportsAtMostFiveErrorsAtOnce() {
        String manyBadRows = """
                a,b,x
                c,d,x
                e,f,x
                g,h,x
                i,j,x
                k,l,x
                m,n,x
                """;

        // 100행짜리 파일에서 전부 틀리면 에러 문구만 수십 줄이 된다 — 앞의 5건으로 자른다
        assertThatThrownBy(() -> parser.parse(utf8(manyBadRows)))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(e.getMessage().split(" / ")).hasSize(5));
    }

    @Test
    void emptyFileIsRejected() {
        assertThatThrownBy(() -> parser.parse(
                new MockMultipartFile("s", "s.csv", "text/csv", new byte[0])))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("비어 있습니다");
    }

    @Test
    void nullFileIsRejected() {
        assertThatThrownBy(() -> parser.parse(null))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("비어 있습니다");
    }

    @Test
    void headerOnlyFileHasNoStudents() {
        assertThatThrownBy(() -> parser.parse(utf8("이름,학교,학년")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("등록할 학생이 없습니다");
    }

    @Test
    void refusesMoreThanAHundredStudents() {
        StringBuilder csv = new StringBuilder();
        for (int i = 0; i < 101; i++) {
            csv.append("학생").append(i).append(",말랑초등학교,2\n");
        }

        // 한 트랜잭션으로 계정을 발급하므로 크기 상한이 곧 사고 반경의 상한이다
        assertThatThrownBy(() -> parser.parse(utf8(csv.toString())))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("최대 100명");
    }

    private MultipartFile utf8(String csv) {
        return new MockMultipartFile("students", "students.csv", "text/csv",
                csv.getBytes(StandardCharsets.UTF_8));
    }
}
