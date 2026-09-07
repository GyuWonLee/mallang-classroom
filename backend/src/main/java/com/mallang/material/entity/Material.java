package com.mallang.material.entity;

import com.mallang.classroom.entity.Classroom;
import com.mallang.assignment.entity.Subject;
import com.mallang.file.entity.UploadedFile;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OneToOne;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.SQLDelete;
import org.hibernate.annotations.SQLRestriction;

import java.time.LocalDateTime;

/**
 * 학습자료 — AI 과제 생성의 grounding 원천 (명세 §6.5).
 * 원본 PDF 는 UploadedFile 이 들고, 여기에는 추출 결과와 상태만 둔다.
 * soft delete: 기존 과제의 sourceRef 가 이 자료를 참조하므로 행을 지우지 않는다.
 */
@Entity
@Table(name = "material")
@SQLDelete(sql = "UPDATE material SET deleted_at = now() WHERE id = ?")
@SQLRestriction("deleted_at is null")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Material {

    /** 미리보기로 돌려주는 최대 길이 — 전문은 생성 때만 쓰고 화면엔 앞부분만 */
    public static final int PREVIEW_LENGTH = 2000;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "classroom_id", nullable = false)
    private Classroom classroom;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "file_id", nullable = false, unique = true)
    private UploadedFile file;

    @Column(nullable = false)
    private String title;

    @Column(columnDefinition = "text")
    private String extractedText;

    @Enumerated(EnumType.STRING)
    private ExtractionSource extractionSource;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private MaterialStatus status;

    private String failureReason;

    /**
     * 이 자료가 몇 학년 것인가 — <b>null 이면 공용</b>이다.
     *
     * <p>과제 만들기에서 자료를 고를 때 목록을 좁히는 데 쓴다. 값이 없는 자료(V33 이전에
     * 올라간 것, 또는 굳이 정하지 않은 것)는 어느 학년에서도 고를 수 있다 — 기존 자료가
     * 목록에서 사라지는 편이 더 큰 사고다.</p>
     */
    private Short grade;

    /** 어느 과목의 자료인가 — null 이면 공용. 학년과 같은 규칙이다. */
    @Enumerated(EnumType.STRING)
    private Subject subject;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    private LocalDateTime deletedAt;

    public static Material uploading(Classroom classroom, UploadedFile file, String title) {
        return uploading(classroom, file, title, null, null);
    }

    /** 학년·과목은 선택이다 — 비워 두면 공용 자료가 된다. */
    public static Material uploading(Classroom classroom, UploadedFile file, String title,
                                     Short grade, Subject subject) {
        Material material = new Material();
        material.classroom = classroom;
        material.file = file;
        material.title = title;
        material.grade = grade;
        material.subject = subject;
        material.status = MaterialStatus.PROCESSING;
        material.createdAt = LocalDateTime.now();
        return material;
    }

    /** 추출 성공 → 선생님 확인 대기 */
    public void previewReady(String extractedText, ExtractionSource source) {
        this.extractedText = extractedText;
        this.extractionSource = source;
        this.status = MaterialStatus.PREVIEW;
        this.failureReason = null;
    }

    public void fail(String reason) {
        this.status = MaterialStatus.FAILED;
        this.failureReason = reason;
    }

    /** 선생님이 미리보기를 확인함 → 생성에 사용 가능 */
    public void confirm() {
        this.status = MaterialStatus.READY;
    }

    public String preview() {
        if (extractedText == null) {
            return null;
        }
        return extractedText.length() <= PREVIEW_LENGTH
                ? extractedText
                : extractedText.substring(0, PREVIEW_LENGTH);
    }

    public int extractedLength() {
        return extractedText == null ? 0 : extractedText.length();
    }
}
