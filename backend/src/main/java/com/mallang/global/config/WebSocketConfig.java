package com.mallang.global.config;

import com.mallang.global.security.StompAuthChannelInterceptor;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

@Configuration
@EnableWebSocketMessageBroker
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final StompAuthChannelInterceptor stompAuthChannelInterceptor;

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // 클라이언트가 최초로 핸드셰이크를 하는 주소
        registry.addEndpoint("/ws")
                .setAllowedOrigins("http://localhost:5173", "https://classroom.example.com");
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        // 명세 v0.6 §10: 발행(클라→서버) /pub → @MessageMapping 컨트롤러로 라우팅
        registry.setApplicationDestinationPrefixes("/pub");
        // 구독(서버→클라) /sub → 브로커가 구독자에게 브로드캐스트. 개인 채널은 /user/sub/notifications
        registry.enableSimpleBroker("/sub");
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        // 클라이언트 -> 서버로 들어오는 모든 STOMP 프레임이 거치는 검문소
        registration.interceptors(stompAuthChannelInterceptor);
    }
}
