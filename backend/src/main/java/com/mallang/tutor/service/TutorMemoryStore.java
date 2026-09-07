package com.mallang.tutor.service;

import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.tutor.entity.AiTutorMemory;
import com.mallang.tutor.repository.AiTutorMemoryRepository;
import com.mallang.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 말랑이 대화 요약의 <b>DB 접촉만</b> 맡는다.
 *
 * <p>왜 별도 빈인가: {@code @Transactional} 은 프록시를 거쳐야 동작한다. 같은 클래스 안에서
 * 부르면 자기호출이라 프록시를 타지 않아 <b>애노테이션이 조용히 무시된다</b> — find-modify-save
 * 가 한 트랜잭션으로 묶이지 않고, 그 사실이 어디에도 드러나지 않는다. 이 리포는 학습자료 추출
 * 쪽에서 같은 함정을 이미 밟은 적이 있어(MaterialExtractionStore) 같은 모양으로 나눈다.</p>
 *
 * <p>{@link TutorMemoryUpdater} 는 LLM 왕복을, 이 클래스는 저장을 맡는다. 트랜잭션이 LLM
 * 왕복을 감싸지 않는 것도 그래서 지켜진다.</p>
 */
@Component
@RequiredArgsConstructor
public class TutorMemoryStore {

    private final AiTutorMemoryRepository memoryRepository;
    private final AssignmentAccessGuard accessGuard;
    private final UserRepository userRepository;

    /** 저장 직전의 최신 요약 — 워커가 이걸 읽어야 앞선 갱신 위에 쌓인다. 없으면 null. */
    @Transactional(readOnly = true)
    public String currentSummary(Long classroomId, Long studentId) {
        return memoryRepository.findByClassroomIdAndStudentId(classroomId, studentId)
                .map(AiTutorMemory::getSummary)
                .orElse(null);
    }

    /** 학급+학생당 한 행에 덮어쓴다. 없으면 만든다. */
    @Transactional
    public void save(Long classroomId, Long studentId, String newSummary) {
        if (newSummary == null || newSummary.isBlank()) {
            return;
        }
        AiTutorMemory memory = memoryRepository
                .findByClassroomIdAndStudentId(classroomId, studentId)
                .orElseGet(() -> AiTutorMemory.of(
                        accessGuard.findClassroom(classroomId),
                        userRepository.getReferenceById(studentId),
                        newSummary));
        memory.updateSummary(newSummary);
        memoryRepository.save(memory);
    }
}
