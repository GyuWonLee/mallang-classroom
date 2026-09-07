package com.mallang.session.service;

import com.mallang.global.error.ApiException;
import com.mallang.session.dto.SessionDtos.MediaAction;
import io.livekit.server.RoomServiceClient;
import livekit.LivekitModels;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import retrofit2.Response;

import java.util.ArrayList;
import java.util.List;

/**
 * LiveKit 룸 관리 (server API). 수업 종료 시 학급룸·팀룸을 삭제해 접속 중인 참가자를 즉시 퇴장시킨다.
 * 룸 삭제가 실패해도 수업 종료 자체는 성공해야 하므로 best-effort — 실패는 경고 로그만 남긴다.
 * (이미 발급된 티켓은 TTL 만료로 소멸 — livekit.token-validity 로 조정)
 */
@Slf4j
@Service
public class LiveKitRoomService {

    private static final List<LivekitModels.TrackSource> ALL_MEDIA_SOURCES = List.of(
            LivekitModels.TrackSource.CAMERA,
            LivekitModels.TrackSource.MICROPHONE,
            LivekitModels.TrackSource.SCREEN_SHARE,
            LivekitModels.TrackSource.SCREEN_SHARE_AUDIO);

    private final String apiKey;
    private final String apiSecret;
    private final String apiUrl;
    private RoomServiceClient client;

    public LiveKitRoomService(
            @Value("${livekit.api-key:}") String apiKey,
            @Value("${livekit.api-secret:}") String apiSecret,
            @Value("${livekit.public-url}") String publicUrl) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.apiUrl = toApiUrl(publicUrl);
    }

    /** 세션의 학급룸(session-{id})과 모든 팀룸(session-{id}-team-*)을 삭제한다. */
    public void deleteSessionRooms(Long sessionId) {
        if (apiKey.isBlank() || apiSecret.isBlank()) {
            return; // LiveKit 미설정 환경 — 티켓 발급도 안 되므로 지울 룸이 없다
        }
        String classroomRoom = SessionTicketService.classroomRoomName(sessionId);
        String teamRoomPrefix = classroomRoom + "-team-";
        try {
            List<LivekitModels.Room> rooms = client().listRooms().execute().body();
            if (rooms == null) {
                return;
            }
            for (LivekitModels.Room room : rooms) {
                String name = room.getName();
                if (name.equals(classroomRoom) || name.startsWith(teamRoomPrefix)) {
                    client().deleteRoom(name).execute();
                }
            }
        } catch (Exception e) {
            log.warn("LiveKit 룸 삭제 실패 (sessionId={}) — 룸은 비면 자동 소멸, 티켓은 TTL로 만료된다",
                    sessionId, e);
        }
    }

    /**
     * 참가자를 룸에서 즉시 끊는다 (강퇴). 이미 나갔거나 접속한 적 없으면(404) 조용히 통과한다 —
     * 강퇴는 "지금 끊는 것"이 아니라 "다시 못 들어오게 하는 것"이 본질이고, 그쪽은 Redis 명단이 맡는다.
     *
     * <p>그 외 실패는 던진다. 룸 삭제(수업 종료)와 달리 여기서 조용히 넘기면 선생님은 내보냈다고
     * 믿는데 학생 화면은 그대로 붙어 있는 상태가 된다.</p>
     */
    public void removeParticipant(String roomName, String identity) {
        requireConfigured();
        try {
            Response<Void> response = client().removeParticipant(roomName, identity).execute();
            if (!response.isSuccessful() && response.code() != HttpStatus.NOT_FOUND.value()) {
                log.warn("LiveKit 참가자 제거 실패 (room={}, identity={}, httpStatus={})",
                        roomName, identity, response.code());
                throw liveKitFailure("LiveKit 참가자 제거에 실패했습니다.");
            }
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            log.warn("LiveKit 참가자 제거 실패 (room={}, identity={})", roomName, identity, e);
            throw liveKitFailure("LiveKit 참가자 제거에 실패했습니다.");
        }
    }

    /** 현재 트랙을 즉시 음소거하고, Redis에서 계산된 마이크·카메라 잠금 상태를 LiveKit에 적용한다. */
    public void applyMediaLocks(String roomName, String identity,
                                boolean microphoneLocked, boolean cameraLocked) {
        applyMediaState(roomName, identity, microphoneLocked, cameraLocked, null);
    }

    /**
     * 선생님의 단일 미디어 제어 요청을 적용한다.
     *
     * 잠금은 현재 트랙을 먼저 음소거한 뒤 발행 권한을 회수한다. 해제는 발행 권한을 먼저
     * 복구한 뒤 해당 트랙만 원격 음소거 해제한다. action을 함께 받는 이유는 카메라 해제가
     * 학생이 스스로 꺼 둔 마이크까지 켜는 식의 부작용을 막기 위해서다.
     */
    public void applyMediaControl(String roomName, String identity,
                                  boolean microphoneLocked, boolean cameraLocked,
                                  MediaAction action) {
        applyMediaState(roomName, identity, microphoneLocked, cameraLocked, action);
    }

    private void applyMediaState(String roomName, String identity,
                                 boolean microphoneLocked, boolean cameraLocked,
                                 MediaAction action) {
        requireConfigured();
        try {
            LivekitModels.ParticipantInfo participant = getParticipantIfConnected(
                    roomName, identity);
            if (participant == null) {
                return; // 미접속 학생은 Redis와 다음 /join 제한 토큰으로 잠근다
            }

            if (action == null) {
                // 웹훅 재접속 복원 경로: 잠긴 미디어만 다시 잠그고, 잠기지 않은 트랙은 건드리지 않는다.
                if (microphoneLocked) {
                    setTrackMutedIfPublished(roomName, identity, participant,
                            LivekitModels.TrackSource.MICROPHONE, "마이크", true);
                }
                if (cameraLocked) {
                    setTrackMutedIfPublished(roomName, identity, participant,
                            LivekitModels.TrackSource.CAMERA, "카메라", true);
                }
                updatePublishSources(roomName, identity, participant,
                        allowedSources(microphoneLocked, cameraLocked));
                return;
            }

            switch (action) {
                case MUTE_MIC -> {
                    setTrackMutedIfPublished(roomName, identity, participant,
                            LivekitModels.TrackSource.MICROPHONE, "마이크", true);
                    updatePublishSources(roomName, identity, participant,
                            allowedSources(microphoneLocked, cameraLocked));
                }
                case DISABLE_CAM -> {
                    setTrackMutedIfPublished(roomName, identity, participant,
                            LivekitModels.TrackSource.CAMERA, "카메라", true);
                    updatePublishSources(roomName, identity, participant,
                            allowedSources(microphoneLocked, cameraLocked));
                }
                case UNLOCK_MIC -> {
                    updatePublishSources(roomName, identity, participant,
                            allowedSources(microphoneLocked, cameraLocked));
                    setTrackMutedIfPublished(roomName, identity, participant,
                            LivekitModels.TrackSource.MICROPHONE, "마이크", false);
                }
                case UNLOCK_CAM -> {
                    updatePublishSources(roomName, identity, participant,
                            allowedSources(microphoneLocked, cameraLocked));
                    setTrackMutedIfPublished(roomName, identity, participant,
                            LivekitModels.TrackSource.CAMERA, "카메라", false);
                }
                default -> throw new IllegalStateException("검증되지 않은 미디어 제어 동작입니다.");
            }
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            log.warn("LiveKit 미디어 잠금 적용 실패 (room={}, identity={}, mic={}, camera={})",
                    roomName, identity, microphoneLocked, cameraLocked, e);
            throw liveKitFailure("LiveKit 미디어 권한 변경에 실패했습니다.");
        }
    }

    private void setTrackMutedIfPublished(String roomName, String identity,
                                          LivekitModels.ParticipantInfo participant,
                                          LivekitModels.TrackSource source,
                                          String mediaName,
                                          boolean muted) throws Exception {
        LivekitModels.TrackInfo track = participant.getTracksList().stream()
                .filter(info -> info.getSource() == source)
                .findFirst()
                .orElse(null);
        if (track == null || track.getMuted() == muted) {
            return;
        }
        Response<LivekitModels.TrackInfo> response = client()
                .mutePublishedTrack(roomName, identity, track.getSid(), muted)
                .execute();
        if (!response.isSuccessful()) {
            String operation = muted ? "음소거" : "음소거 해제";
            log.warn(
                    "LiveKit 트랙 {} 실패 (room={}, identity={}, trackSid={}, source={}, httpStatus={})",
                    operation, roomName, identity, track.getSid(), source, response.code());
            throw liveKitFailure("LiveKit " + mediaName + " " + operation + "에 실패했습니다.");
        }
    }

    private List<LivekitModels.TrackSource> allowedSources(boolean microphoneLocked,
                                                            boolean cameraLocked) {
        List<LivekitModels.TrackSource> allowed = new ArrayList<>(ALL_MEDIA_SOURCES);
        if (microphoneLocked) {
            allowed.remove(LivekitModels.TrackSource.MICROPHONE);
        }
        if (cameraLocked) {
            allowed.remove(LivekitModels.TrackSource.CAMERA);
        }
        return allowed;
    }

    private LivekitModels.ParticipantInfo getParticipantIfConnected(
            String roomName, String identity) throws Exception {
        Response<LivekitModels.ParticipantInfo> response = client()
                .getParticipant(roomName, identity)
                .execute();
        if (response.code() == HttpStatus.NOT_FOUND.value()) {
            return null;
        }
        if (!response.isSuccessful() || response.body() == null) {
            throw liveKitFailure("LiveKit 참가자 조회에 실패했습니다.");
        }
        return response.body();
    }

    private void updatePublishSources(String roomName, String identity,
                                      LivekitModels.ParticipantInfo participant,
                                      List<LivekitModels.TrackSource> allowedSources)
            throws Exception {
        LivekitModels.ParticipantPermission.Builder permission = participant.hasPermission()
                ? participant.getPermission().toBuilder()
                : LivekitModels.ParticipantPermission.newBuilder()
                        .setCanSubscribe(true)
                        .setCanPublishData(false);
        permission.setCanPublish(true)
                .clearCanPublishSources()
                .addAllCanPublishSources(allowedSources);

        Response<LivekitModels.ParticipantInfo> response = client()
                // null이면 name/metadata 필드가 요청에서 빠져 기존 참가자 정보를 보존한다.
                .updateParticipant(roomName, identity, null, null, permission.build())
                .execute();
        if (!response.isSuccessful()) {
            throw liveKitFailure("LiveKit 참가자 권한 변경에 실패했습니다.");
        }
    }

    private void requireConfigured() {
        if (apiKey.isBlank() || apiSecret.isBlank()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "livekit-not-configured",
                    "LiveKit API credentials are not configured.");
        }
    }

    private ApiException liveKitFailure(String message) {
        return new ApiException(HttpStatus.BAD_GATEWAY, "livekit-api-failed", message);
    }

    synchronized RoomServiceClient client() {
        if (client == null) {
            client = RoomServiceClient.createClient(apiUrl, apiKey, apiSecret);
        }
        return client;
    }

    /** 클라 접속 주소(ws/wss)를 server API 호출용 http/https 로 변환 */
    static String toApiUrl(String url) {
        if (url.startsWith("wss://")) {
            return "https://" + url.substring("wss://".length());
        }
        if (url.startsWith("ws://")) {
            return "http://" + url.substring("ws://".length());
        }
        return url;
    }
}
