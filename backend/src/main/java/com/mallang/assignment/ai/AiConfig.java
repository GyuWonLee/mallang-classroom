package com.mallang.assignment.ai;

import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.task.TaskExecutor;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

@Configuration
@EnableAsync
@EnableConfigurationProperties(AiProperties.class)
public class AiConfig {

    /** AI 과제 생성은 수십 초 걸릴 수 있어 별도 스레드풀에서 비동기 실행한다. */
    @Bean("aiGenerationExecutor")
    public TaskExecutor aiGenerationExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("ai-gen-");
        executor.initialize();
        return executor;
    }

    /** 실제 Claude 호출용 클라이언트. ai.provider=anthropic 일 때만 생성 (키 없으면 시작 실패 방지). */
    @Bean
    @ConditionalOnProperty(name = "ai.provider", havingValue = "anthropic")
    public AnthropicClient anthropicClient(AiProperties properties) {
        var builder = AnthropicOkHttpClient.builder()
                .apiKey(properties.anthropic().apiKey());
        String baseUrl = properties.anthropic().baseUrl();
        if (baseUrl != null && !baseUrl.isBlank()) {
            builder.baseUrl(baseUrl); // SSAFY 게이트웨이 등 커스텀 엔드포인트
        }
        return builder.build();
    }
}
