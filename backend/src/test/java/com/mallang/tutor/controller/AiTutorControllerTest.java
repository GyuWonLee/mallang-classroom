package com.mallang.tutor.controller;

import com.mallang.support.ApiTestSupport;
import com.mallang.tutor.dto.TutorDtos.ActionDecisionRequest;
import com.mallang.tutor.dto.TutorDtos.ActionDecisionRequest.Decision;
import com.mallang.tutor.dto.TutorDtos.ActionResultResponse;
import com.mallang.tutor.dto.TutorDtos.AnswerResponse;
import com.mallang.tutor.dto.TutorDtos.AskRequest;
import com.mallang.tutor.dto.TutorDtos.MaterialTarget;
import com.mallang.tutor.dto.TutorDtos.ProposedActionResponse;
import com.mallang.tutor.entity.AiTutorMessage.AnsweredBy;
import com.mallang.tutor.entity.TutorActionStatus;
import com.mallang.tutor.entity.TutorActionType;
import com.mallang.tutor.service.AiTutorService;
import com.mallang.tutor.service.TutorActionExecutor.Delivery;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.time.LocalDateTime;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 말랑이 API 의 HTTP 계약 — 프론트가 이 모양에 맞춰 붙는다.
 *
 * <p>특히 확인 후 실행의 두 응답 모양(제안이 실린 답 / 실행 결과)을 여기서 고정한다.</p>
 */
@WebMvcTest(AiTutorController.class)
class AiTutorControllerTest extends ApiTestSupport {

    @MockitoBean
    AiTutorService aiTutorService;

    @Test
    @DisplayName("제안이 있으면 답과 함께 proposedAction 이 실려 온다")
    void answerCarriesTheProposal() throws Exception {
        when(aiTutorService.ask(any(), any())).thenReturn(new AnswerResponse(
                77L, "그건 선생님께 여쭤보는 게 좋겠어. 내가 대신 여쭤봐 줄까?", AnsweredBy.LLM,
                new ProposedActionResponse(TutorActionType.ASK_TEACHER, "시험 범위",
                        "민수가 이번 주 받아쓰기 시험 범위를 궁금해합니다.", null,
                        LocalDateTime.now().plusHours(24))));

        mockMvc.perform(post("/api/ai/tutor/messages").with(as(STUDENT))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(new AskRequest(5L, "시험 범위 알려주세요"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messageId").value(77))
                .andExpect(jsonPath("$.answeredBy").value("LLM"))
                .andExpect(jsonPath("$.proposedAction.type").value("ASK_TEACHER"))
                // 무엇이 선생님에게 가는지 보여줘야 아이가 확인할 수 있다
                .andExpect(jsonPath("$.proposedAction.content").exists())
                .andExpect(jsonPath("$.proposedAction.expiresAt").exists());
    }

    @Test
    @DisplayName("제안이 없으면 proposedAction 은 null 이다")
    void answerWithoutProposal() throws Exception {
        when(aiTutorService.ask(any(), any())).thenReturn(
                new AnswerResponse(78L, "받침은 글자 아래에 붙어!", AnsweredBy.LLM, null));

        mockMvc.perform(post("/api/ai/tutor/messages").with(as(STUDENT))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(new AskRequest(5L, "받침이 뭐야"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.proposedAction").doesNotExist());
    }

    @Test
    @DisplayName("CONFIRM 하면 실행 결과(전달 경로)를 돌려준다")
    void confirmReturnsHowItWasDelivered() throws Exception {
        when(aiTutorService.decideAction(any(), eq(77L), any())).thenReturn(
                new ActionResultResponse(77L, TutorActionStatus.CONFIRMED,
                        TutorActionType.ASK_TEACHER, Delivery.DIRECT_MESSAGE, null));

        mockMvc.perform(post("/api/ai/tutor/messages/77/action").with(as(STUDENT))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(new ActionDecisionRequest(Decision.CONFIRM))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CONFIRMED"))
                // 화면 문구가 갈린다 — "선생님께 전달했어요" vs "쪽지함에 남겼어요"
                .andExpect(jsonPath("$.delivery").value("DIRECT_MESSAGE"));
    }

    @Test
    @DisplayName("SHOW_MATERIAL 을 확인하면 열어 줄 자료가 온다")
    void confirmReturnsTheMaterialToOpen() throws Exception {
        when(aiTutorService.decideAction(any(), eq(78L), any())).thenReturn(
                new ActionResultResponse(78L, TutorActionStatus.CONFIRMED,
                        TutorActionType.SHOW_MATERIAL, null, new MaterialTarget(12L, "겹받침 연습지")));

        mockMvc.perform(post("/api/ai/tutor/messages/78/action").with(as(STUDENT))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(new ActionDecisionRequest(Decision.CONFIRM))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.material.id").value(12))
                .andExpect(jsonPath("$.material.title").value("겹받침 연습지"));
    }

    @Test
    @DisplayName("decision 이 없으면 400 — 실수로 실행되면 안 된다")
    void decisionIsRequired() throws Exception {
        mockMvc.perform(post("/api/ai/tutor/messages/77/action").with(as(STUDENT))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("모르는 decision 값도 400 으로 막는다")
    void unknownDecisionIsRejected() throws Exception {
        mockMvc.perform(post("/api/ai/tutor/messages/77/action").with(as(STUDENT))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"DELETE_EVERYTHING\"}"))
                .andExpect(status().isBadRequest());
    }
}
