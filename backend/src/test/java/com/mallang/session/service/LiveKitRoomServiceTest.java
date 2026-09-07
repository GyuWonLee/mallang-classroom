package com.mallang.session.service;

import com.mallang.global.error.ApiException;
import com.mallang.session.dto.SessionDtos.MediaAction;
import io.livekit.server.RoomServiceClient;
import livekit.LivekitModels;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import retrofit2.Call;
import retrofit2.Response;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class LiveKitRoomServiceTest {

    private static final String ROOM = "session-10-team-3";
    private static final String IDENTITY = "student-11";

    @Test
    void convertsWebSocketUrlToHttpApiUrl() {
        assertThat(LiveKitRoomService.toApiUrl("wss://classroom.example.com:8443"))
                .isEqualTo("https://classroom.example.com:8443");
        assertThat(LiveKitRoomService.toApiUrl("ws://localhost:7880"))
                .isEqualTo("http://localhost:7880");
        assertThat(LiveKitRoomService.toApiUrl("https://already-http.example.com"))
                .isEqualTo("https://already-http.example.com");
    }

    @Test
    void lockMutesCurrentTrackAndRemovesMicrophonePublishPermission() throws Exception {
        RoomServiceClient client = mock(RoomServiceClient.class);
        LiveKitRoomService service = serviceWith(client);
        LivekitModels.TrackInfo microphone = microphone(false);
        LivekitModels.ParticipantInfo participant = participant(microphone);
        stubParticipant(client, Response.success(participant));

        Call<LivekitModels.TrackInfo> muteCall = mock(Call.class);
        when(client.mutePublishedTrack(ROOM, IDENTITY, "TR_MIC", true))
                .thenReturn(muteCall);
        when(muteCall.execute()).thenReturn(Response.success(microphone));
        Call<LivekitModels.ParticipantInfo> updateCall = stubPermissionUpdate(client, participant);

        service.applyMediaLocks(ROOM, IDENTITY, true, false);

        verify(muteCall).execute();
        verify(updateCall).execute();
        LivekitModels.ParticipantPermission permission = capturedPermission(client);
        assertThat(permission.getCanPublish()).isTrue();
        assertThat(permission.getCanPublishSourcesList())
                .containsExactly(
                        LivekitModels.TrackSource.CAMERA,
                        LivekitModels.TrackSource.SCREEN_SHARE,
                        LivekitModels.TrackSource.SCREEN_SHARE_AUDIO)
                .doesNotContain(LivekitModels.TrackSource.MICROPHONE);
    }

    @Test
    void lockStillRevokesPermissionWhenStudentHasNoPublishedMicrophone() throws Exception {
        RoomServiceClient client = mock(RoomServiceClient.class);
        LiveKitRoomService service = serviceWith(client);
        LivekitModels.ParticipantInfo participant = participant();
        stubParticipant(client, Response.success(participant));
        stubPermissionUpdate(client, participant);

        service.applyMediaLocks(ROOM, IDENTITY, true, false);

        verify(client, never()).mutePublishedTrack(
                eq(ROOM), eq(IDENTITY), any(String.class), eq(true));
        assertThat(capturedPermission(client).getCanPublishSourcesList())
                .doesNotContain(LivekitModels.TrackSource.MICROPHONE);
    }

    @Test
    void reapplyWithNoLocksRestoresEveryPublishPermissionWithoutChangingTracks()
            throws Exception {
        RoomServiceClient client = mock(RoomServiceClient.class);
        LiveKitRoomService service = serviceWith(client);
        LivekitModels.ParticipantInfo participant = participant();
        stubParticipant(client, Response.success(participant));
        stubPermissionUpdate(client, participant);

        service.applyMediaLocks(ROOM, IDENTITY, false, false);

        assertThat(capturedPermission(client).getCanPublishSourcesList())
                .containsExactly(
                        LivekitModels.TrackSource.CAMERA,
                        LivekitModels.TrackSource.MICROPHONE,
                        LivekitModels.TrackSource.SCREEN_SHARE,
                        LivekitModels.TrackSource.SCREEN_SHARE_AUDIO);
        verify(client, never()).mutePublishedTrack(
                eq(ROOM), eq(IDENTITY), any(String.class),
                org.mockito.ArgumentMatchers.anyBoolean());
    }

    @Test
    void unlockMicrophoneRestoresPermissionThenUnmutesOnlyMicrophone() throws Exception {
        RoomServiceClient client = mock(RoomServiceClient.class);
        LiveKitRoomService service = serviceWith(client);
        LivekitModels.TrackInfo microphone = microphone(true);
        LivekitModels.TrackInfo camera = camera(true);
        LivekitModels.ParticipantInfo participant = participant(microphone, camera);
        stubParticipant(client, Response.success(participant));
        stubPermissionUpdate(client, participant);

        Call<LivekitModels.TrackInfo> unmuteCall = mock(Call.class);
        when(client.mutePublishedTrack(ROOM, IDENTITY, "TR_MIC", false))
                .thenReturn(unmuteCall);
        when(unmuteCall.execute()).thenReturn(Response.success(microphone));

        service.applyMediaControl(
                ROOM, IDENTITY, false, false, MediaAction.UNLOCK_MIC);

        InOrder order = inOrder(client);
        order.verify(client).updateParticipant(
                eq(ROOM), eq(IDENTITY), isNull(), isNull(),
                any(LivekitModels.ParticipantPermission.class));
        order.verify(client).mutePublishedTrack(ROOM, IDENTITY, "TR_MIC", false);
        verify(client, never()).mutePublishedTrack(ROOM, IDENTITY, "TR_CAM", false);
    }

    @Test
    void unlockCameraKeepsMicrophonePermissionLockedAndUnmutesOnlyCamera()
            throws Exception {
        RoomServiceClient client = mock(RoomServiceClient.class);
        LiveKitRoomService service = serviceWith(client);
        LivekitModels.TrackInfo microphone = microphone(true);
        LivekitModels.TrackInfo camera = camera(true);
        LivekitModels.ParticipantInfo participant = participant(microphone, camera);
        stubParticipant(client, Response.success(participant));
        stubPermissionUpdate(client, participant);

        Call<LivekitModels.TrackInfo> unmuteCall = mock(Call.class);
        when(client.mutePublishedTrack(ROOM, IDENTITY, "TR_CAM", false))
                .thenReturn(unmuteCall);
        when(unmuteCall.execute()).thenReturn(Response.success(camera));

        service.applyMediaControl(
                ROOM, IDENTITY, true, false, MediaAction.UNLOCK_CAM);

        assertThat(capturedPermission(client).getCanPublishSourcesList())
                .doesNotContain(LivekitModels.TrackSource.MICROPHONE)
                .contains(LivekitModels.TrackSource.CAMERA);
        InOrder order = inOrder(client);
        order.verify(client).updateParticipant(
                eq(ROOM), eq(IDENTITY), isNull(), isNull(),
                any(LivekitModels.ParticipantPermission.class));
        order.verify(client).mutePublishedTrack(ROOM, IDENTITY, "TR_CAM", false);
        verify(client, never()).mutePublishedTrack(ROOM, IDENTITY, "TR_MIC", false);
    }

    @Test
    void cameraLockMutesCurrentTrackAndKeepsScreenSharePermission() throws Exception {
        RoomServiceClient client = mock(RoomServiceClient.class);
        LiveKitRoomService service = serviceWith(client);
        LivekitModels.TrackInfo camera = camera(false);
        LivekitModels.ParticipantInfo participant = participant(camera);
        stubParticipant(client, Response.success(participant));

        Call<LivekitModels.TrackInfo> muteCall = mock(Call.class);
        when(client.mutePublishedTrack(ROOM, IDENTITY, "TR_CAM", true))
                .thenReturn(muteCall);
        when(muteCall.execute()).thenReturn(Response.success(camera));
        stubPermissionUpdate(client, participant);

        service.applyMediaLocks(ROOM, IDENTITY, false, true);

        verify(muteCall).execute();
        assertThat(capturedPermission(client).getCanPublishSourcesList())
                .containsExactly(
                        LivekitModels.TrackSource.MICROPHONE,
                        LivekitModels.TrackSource.SCREEN_SHARE,
                        LivekitModels.TrackSource.SCREEN_SHARE_AUDIO)
                .doesNotContain(LivekitModels.TrackSource.CAMERA);
    }

    @Test
    void combinedLocksRemoveOnlyMicrophoneAndCameraPermissions() throws Exception {
        RoomServiceClient client = mock(RoomServiceClient.class);
        LiveKitRoomService service = serviceWith(client);
        LivekitModels.TrackInfo microphone = microphone(true);
        LivekitModels.TrackInfo camera = camera(true);
        LivekitModels.ParticipantInfo participant = participant(microphone, camera);
        stubParticipant(client, Response.success(participant));
        stubPermissionUpdate(client, participant);

        service.applyMediaLocks(ROOM, IDENTITY, true, true);

        assertThat(capturedPermission(client).getCanPublishSourcesList())
                .containsExactly(
                        LivekitModels.TrackSource.SCREEN_SHARE,
                        LivekitModels.TrackSource.SCREEN_SHARE_AUDIO);
    }

    @Test
    void offlineStudentIsHandledByRedisAndNextJoinWithoutLiveKitUpdate() throws Exception {
        RoomServiceClient client = mock(RoomServiceClient.class);
        LiveKitRoomService service = serviceWith(client);
        @SuppressWarnings("unchecked")
        Response<LivekitModels.ParticipantInfo> notFound = mock(Response.class);
        when(notFound.code()).thenReturn(404);
        stubParticipant(client, notFound);

        service.applyMediaLocks(ROOM, IDENTITY, true, false);

        verify(client, never()).updateParticipant(
                eq(ROOM), eq(IDENTITY), isNull(), isNull(),
                any(LivekitModels.ParticipantPermission.class));
        verify(client, never()).mutePublishedTrack(
                eq(ROOM), eq(IDENTITY), any(String.class), eq(true));
    }

    @Test
    void liveKitLookupFailureBecomesBadGateway() throws Exception {
        RoomServiceClient client = mock(RoomServiceClient.class);
        LiveKitRoomService service = serviceWith(client);
        @SuppressWarnings("unchecked")
        Response<LivekitModels.ParticipantInfo> failed = mock(Response.class);
        when(failed.code()).thenReturn(500);
        when(failed.isSuccessful()).thenReturn(false);
        stubParticipant(client, failed);

        assertThatThrownBy(() -> service.applyMediaLocks(ROOM, IDENTITY, true, false))
                .isInstanceOf(ApiException.class)
                .satisfies(error -> assertThat(((ApiException) error).getStatus().value())
                        .isEqualTo(502));
    }

    @Test
    void liveKitTrackControlFailureBecomesBadGateway() throws Exception {
        RoomServiceClient client = mock(RoomServiceClient.class);
        LiveKitRoomService service = serviceWith(client);
        LivekitModels.TrackInfo microphone = microphone(false);
        stubParticipant(client, Response.success(participant(microphone)));

        @SuppressWarnings("unchecked")
        Call<LivekitModels.TrackInfo> muteCall = mock(Call.class);
        @SuppressWarnings("unchecked")
        Response<LivekitModels.TrackInfo> failed = mock(Response.class);
        when(failed.isSuccessful()).thenReturn(false);
        when(failed.code()).thenReturn(503);
        when(client.mutePublishedTrack(ROOM, IDENTITY, "TR_MIC", true))
                .thenReturn(muteCall);
        when(muteCall.execute()).thenReturn(failed);

        assertThatThrownBy(() -> service.applyMediaControl(
                ROOM, IDENTITY, true, false, MediaAction.MUTE_MIC))
                .isInstanceOf(ApiException.class)
                .satisfies(error -> assertThat(((ApiException) error).getStatus().value())
                        .isEqualTo(502));
    }

    private LiveKitRoomService serviceWith(RoomServiceClient client) {
        LiveKitRoomService service = spy(new LiveKitRoomService(
                "test-key", "test-secret", "ws://localhost:7880"));
        doReturn(client).when(service).client();
        return service;
    }

    private void stubParticipant(RoomServiceClient client,
                                 Response<LivekitModels.ParticipantInfo> response)
            throws Exception {
        @SuppressWarnings("unchecked")
        Call<LivekitModels.ParticipantInfo> call = mock(Call.class);
        when(client.getParticipant(ROOM, IDENTITY)).thenReturn(call);
        when(call.execute()).thenReturn(response);
    }

    private Call<LivekitModels.ParticipantInfo> stubPermissionUpdate(
            RoomServiceClient client, LivekitModels.ParticipantInfo result) throws Exception {
        @SuppressWarnings("unchecked")
        Call<LivekitModels.ParticipantInfo> call = mock(Call.class);
        when(client.updateParticipant(
                eq(ROOM), eq(IDENTITY), isNull(), isNull(),
                any(LivekitModels.ParticipantPermission.class)))
                .thenReturn(call);
        when(call.execute()).thenReturn(Response.success(result));
        return call;
    }

    private LivekitModels.ParticipantPermission capturedPermission(RoomServiceClient client) {
        ArgumentCaptor<LivekitModels.ParticipantPermission> captor =
                ArgumentCaptor.forClass(LivekitModels.ParticipantPermission.class);
        verify(client).updateParticipant(eq(ROOM), eq(IDENTITY), isNull(), isNull(),
                captor.capture());
        return captor.getValue();
    }

    private LivekitModels.ParticipantInfo participant(LivekitModels.TrackInfo... tracks) {
        LivekitModels.ParticipantPermission permission =
                LivekitModels.ParticipantPermission.newBuilder()
                        .setCanSubscribe(true)
                        .setCanPublish(true)
                        .setCanPublishData(false)
                        .addAllCanPublishSources(List.of(
                                LivekitModels.TrackSource.CAMERA,
                                LivekitModels.TrackSource.MICROPHONE,
                                LivekitModels.TrackSource.SCREEN_SHARE,
                                LivekitModels.TrackSource.SCREEN_SHARE_AUDIO))
                        .build();
        return LivekitModels.ParticipantInfo.newBuilder()
                .setIdentity(IDENTITY)
                .setPermission(permission)
                .addAllTracks(List.of(tracks))
                .build();
    }

    private LivekitModels.TrackInfo microphone(boolean muted) {
        return LivekitModels.TrackInfo.newBuilder()
                .setSid("TR_MIC")
                .setSource(LivekitModels.TrackSource.MICROPHONE)
                .setMuted(muted)
                .build();
    }

    private LivekitModels.TrackInfo camera(boolean muted) {
        return LivekitModels.TrackInfo.newBuilder()
                .setSid("TR_CAM")
                .setSource(LivekitModels.TrackSource.CAMERA)
                .setMuted(muted)
                .build();
    }
}
