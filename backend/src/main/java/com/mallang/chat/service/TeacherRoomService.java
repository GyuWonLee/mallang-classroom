package com.mallang.chat.service;

import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.chat.dto.ChatDtos.MessageResponse;
import com.mallang.chat.dto.ChatDtos.TeacherRoomRequest;
import com.mallang.chat.dto.ChatDtos.TeacherRoomSummary;
import com.mallang.chat.entity.ChatMessage;
import com.mallang.chat.entity.TeacherRoomRead;
import com.mallang.chat.repository.ChatMessageRepository;
import com.mallang.chat.repository.TeacherRoomReadRepository;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.realtime.dto.StompEnvelope;
import com.mallang.realtime.dto.StompEventType;
import com.mallang.global.security.AuthUser;
import com.mallang.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 학급 교사 단톡방 — 한 학급을 맡은 선생님들끼리 쓰는 방.
 *
 * <p>방을 따로 만들지 않는다. 학급이 곧 방이고, 그 학급의 OWNER/MAINTAINER 가 곧 참여자다.
 * 그래서 선생님이 초대되면 별도 절차 없이 바로 방이 생긴 것처럼 보이고, 내보내면 사라진다 —
 * 멤버십을 두 곳에서 관리하면 반드시 어긋난다.</p>
 *
 * <p>실시간 전달은 새 STOMP 토픽을 만들지 않고 이미 인가된 개인 채널
 * ({@code /user/sub/notifications})을 쓴다. 구독 화이트리스트를 늘리면 그만큼 검문 로직이
 * 늘고, 단톡방은 받는 사람이 명확해(그 학급 교사) 개인 채널로 충분하다.</p>
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class TeacherRoomService {

    private static final List<ClassroomRole> TEACHER_ROLES =
            List.of(ClassroomRole.OWNER, ClassroomRole.MAINTAINER);
    private static final String PERSONAL_DESTINATION = "/sub/notifications";

    private final AssignmentAccessGuard accessGuard;
    private final ChatMessageRepository chatMessageRepository;
    private final TeacherRoomReadRepository readRepository;
    private final ClassroomMemberRepository memberRepository;
    private final UserRepository userRepository;
    private final SimpMessagingTemplate messagingTemplate;

    /** 방 열기 — 지금까지의 대화. 학생은 requireManager 에서 막힌다. */
    public List<MessageResponse> messages(AuthUser viewer, Long classroomId) {
        accessGuard.requireManager(classroomId, viewer.id());
        return chatMessageRepository.findTeacherRoom(classroomId).stream()
                .map(MessageResponse::from)
                .toList();
    }

    /** 목록 화면용 — 마지막 메시지와 안 읽은 수만. 방 전체를 불러오지 않는다. */
    public TeacherRoomSummary summary(AuthUser viewer, Long classroomId) {
        accessGuard.requireManager(classroomId, viewer.id());
        /*
          읽은 기록이 없으면 "그 시각 이후"라는 조건 자체가 없다 — 남이 보낸 전부가 안 읽음이다.
          한 쿼리에 null 을 넘겨 분기하지 않는 이유는 저장소 주석에 적었다(Postgres 가 터진다).
        */
        LocalDateTime since = lastReadAt(classroomId, viewer.id());
        long unread = since == null
                ? chatMessageRepository.countTeacherRoomUnread(classroomId, viewer.id())
                : chatMessageRepository.countTeacherRoomUnreadSince(classroomId, viewer.id(), since);

        MessageResponse last = chatMessageRepository
                .findFirstByClassroomIdAndSessionIsNullAndRecipientIsNullOrderByCreatedAtDesc(classroomId)
                .map(MessageResponse::from)
                .orElse(null);
        return new TeacherRoomSummary(classroomId, last, unread);
    }

    @Transactional
    public MessageResponse send(AuthUser sender, Long classroomId, TeacherRoomRequest request) {
        Classroom classroom = accessGuard.requireManager(classroomId, sender.id());

        ChatMessage saved = chatMessageRepository.save(ChatMessage.teacherRoom(
                classroom,
                userRepository.getReferenceById(sender.id()),
                request.content()));
        MessageResponse response = MessageResponse.from(saved);

        // 보낸 사람에게는 보내지 않는다 — 응답으로 이미 받았고, 두 번 그리면 화면에 중복된다.
        for (Long teacherId : memberRepository.findUserIdsByClassroomIdAndRoleIn(
                classroomId, TEACHER_ROLES)) {
            if (teacherId.equals(sender.id())) {
                continue;
            }
            messagingTemplate.convertAndSendToUser(String.valueOf(teacherId), PERSONAL_DESTINATION,
                    StompEnvelope.of(StompEventType.TEACHER_ROOM_MESSAGE,
                            Map.of("classroomId", classroomId, "message", response)));
        }
        return response;
    }

    /**
     * 여기까지 읽었다고 표시. 시각은 서버가 정한다 — 클라이언트가 준 값을 믿으면 시계가
     * 어긋난 기기 하나가 남의 안 읽음까지 지운다.
     */
    @Transactional
    public void markRead(AuthUser viewer, Long classroomId) {
        Classroom classroom = accessGuard.requireManager(classroomId, viewer.id());
        LocalDateTime now = LocalDateTime.now();

        readRepository.findByClassroomIdAndUserId(classroomId, viewer.id())
                .ifPresentOrElse(
                        read -> read.advanceTo(now),
                        () -> readRepository.save(TeacherRoomRead.of(
                                classroom, userRepository.getReferenceById(viewer.id()), now)));
    }

    /** 읽은 기록이 없으면 null — 한 번도 안 읽었다는 뜻이고, 그때는 전부가 안 읽음이다. */
    private LocalDateTime lastReadAt(Long classroomId, Long userId) {
        return readRepository.findByClassroomIdAndUserId(classroomId, userId)
                .map(TeacherRoomRead::getLastReadAt)
                .orElse(null);
    }
}
