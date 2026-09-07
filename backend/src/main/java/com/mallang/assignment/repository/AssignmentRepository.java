package com.mallang.assignment.repository;

import com.mallang.assignment.entity.Assignment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

public interface AssignmentRepository extends JpaRepository<Assignment, Long> {

    // 선생님용 — 초안 포함 전체
    List<Assignment> findByClassroomIdOrderByCreatedAtDesc(Long classroomId);

    // 학생용 — 발행된 것만
    List<Assignment> findByClassroomIdAndPublishedAtIsNotNullOrderByCreatedAtDesc(Long classroomId);

    /**
     * 학생에게 보이는 발행 과제 — 학년·학생 대상이 둘 다 비면(학급 전체) 누구에게나,
     * 지정되면 학생의 학년이 대상 학년이거나 본인이 대상 학생일 때만(합집합).
     * 대상 필터를 SQL 에서 처리해 목록마다 컬렉션을 로딩하는 N+1 을 피한다.
     */
    @Query("""
            select a from Assignment a
            where a.classroom.id = :classroomId
              and a.publishedAt is not null
              and (
                    (a.targetGrades is empty and a.targetStudentIds is empty)
                    or :studentGrade in elements(a.targetGrades)
                    or :studentId in elements(a.targetStudentIds)
                  )
            order by a.createdAt desc
            """)
    List<Assignment> findVisibleToStudent(@Param("classroomId") Long classroomId,
                                          @Param("studentId") Long studentId,
                                          @Param("studentGrade") Short studentGrade);

    /**
     * 학급별 발행 과제 수 — 학급 목록의 과제 진행률에서 분모의 한 축이다.
     * 초안은 학생에게 보이지 않으므로 진행률에 들어가면 안 된다.
     * 발행 과제가 없는 학급은 행이 안 나오므로 호출부가 0으로 채운다.
     */
    @Query("select a.classroom.id as classroomId, count(a) as published "
            + "from Assignment a "
            + "where a.classroom.id in :classroomIds and a.publishedAt is not null "
            + "group by a.classroom.id")
    List<PublishedCountView> countPublishedByClassroomIds(
            @Param("classroomIds") Collection<Long> classroomIds);

    interface PublishedCountView {
        Long getClassroomId();

        long getPublished();
    }
}
