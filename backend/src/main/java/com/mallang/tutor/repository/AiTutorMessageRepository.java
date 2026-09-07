package com.mallang.tutor.repository;

import com.mallang.tutor.entity.AiTutorMessage;
import com.mallang.tutor.entity.AiTutorMessage.AnsweredBy;
import com.mallang.tutor.entity.TutorActionStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

public interface AiTutorMessageRepository extends JpaRepository<AiTutorMessage, Long> {

    /** 학생 한 명의 대화 기록 — 최근 것이 위. 선생님의 안전 확인과 학생 본인 복습에 쓴다. */
    List<AiTutorMessage> findByClassroomIdAndStudentIdOrderByCreatedAtDesc(
            Long classroomId, Long studentId);

    /**
     * 다음 답변에 문맥으로 실을 <b>최근 대화 세 턱</b> — 최근 것이 위(호출부가 뒤집는다).
     *
     * <p><b>{@code answeredBy} 로 거른다.</b> 폴백(TEMPLATE)은 "지금은 대답하기 어려워요" 같은
     * 안내 문구이고 차단(BLOCKED)은 고운 말 안내라, 둘 다 대화 내용이 아니다. 그것까지 문맥으로
     * 넣으면 모델이 자기가 그렇게 답했다고 믿고 그 말투를 이어간다.</p>
     */
    List<AiTutorMessage> findTop3ByClassroomIdAndStudentIdAndAnsweredByOrderByCreatedAtDesc(
            Long classroomId, Long studentId, AnsweredBy answeredBy);

    /**
     * 제안 상태만 갱신한다. 호출 지점이 트랜잭션 밖이라(액션 실행이 STOMP·Redis 를 타는 동안
     * 커넥션을 쥐지 않으려고) 더티 체킹을 쓸 수 없어 한 칼럼을 직접 바꾼다.
     * 짧은 자체 트랜잭션으로 끝나므로 실행 왕복과 겹치지 않는다.
     */
    @Modifying
    @Transactional
    @Query("update AiTutorMessage m set m.actionStatus = :status where m.id = :id")
    void updateActionStatus(@Param("id") Long id, @Param("status") TutorActionStatus status);

    /**
     * 학급에서 살펴봐야 할 대화가 있는 학생과 그 건수 — 선생님 화면의 배지 근거.
     *
     * <p>학생마다 한 번씩 묻지 않는다. 복식학급은 한 담임이 여러 학년을 보므로 학생 수만큼
     * 왕복하면 화면 하나가 수십 번 질의한다. 표시된 대화는 소수라 부분 인덱스(V25)를 탄다.
     */
    @Query("select m.student.id as studentId, count(m) as flagged "
            + "from AiTutorMessage m "
            + "where m.classroom.id = :classroomId and m.flagged = true "
            + "group by m.student.id")
    List<FlaggedCountView> countFlaggedByClassroom(@Param("classroomId") Long classroomId);

    interface FlaggedCountView {
        Long getStudentId();

        long getFlagged();
    }
}
