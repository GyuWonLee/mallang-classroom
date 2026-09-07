package com.mallang.global.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

/**
 * 비동기 실행기 — 사용처는 학습자료 추출(PDF 파싱)과 말랑이 대화 요약.
 * 파싱은 CPU 를 쓰는 작업이라 스레드를 넉넉히 두지 않는다. 큐가 차면 호출 스레드에서 실행해
 * (CallerRuns) 작업을 잃지 않는다 — 추출 요청이 조용히 사라지는 것보다 느려지는 게 낫다.
 */
@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean
    public Executor taskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("mallang-async-");
        executor.setRejectedExecutionHandler(
                new java.util.concurrent.ThreadPoolExecutor.CallerRunsPolicy());
        executor.initialize();
        return executor;
    }

    /**
     * 말랑이 대화 요약 전용 실행기.
     *
     * <p>{@link #taskExecutor()} 를 같이 쓰지 않는 이유: 그쪽은 PDF 추출이 스레드를 오래
     * 붙잡는다. 큐가 차면 CallerRuns 로 되돌아오는데, 그러면 요약을 비동기로 뺀 의미가
     * 사라지고 다시 아이의 답변을 막는다.
     *
     * <p>요약은 잃어도 되는 작업이라 정책이 다르다 — 큐가 차면 <b>버린다</b>(AbortPolicy).
     * 던져진 예외는 호출부가 삼키고 로그만 남긴다. 다음 대화 때 다시 시도되므로,
     * 한 번 건너뛴 요약보다 답변이 늦는 쪽이 나쁘다.
     */
    @Bean
    public Executor tutorSummaryExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("mallang-tutor-summary-");
        executor.setRejectedExecutionHandler(
                new java.util.concurrent.ThreadPoolExecutor.AbortPolicy());
        executor.initialize();
        return executor;
    }

    /**
     * 학생 계정 안내 메일 전용 실행기.
     *
     * <p>{@link #taskExecutor()} 를 같이 쓰지 않는 이유: 그쪽은 PDF 추출이 스레드를 오래
     * 붙잡는데(core 2), 100명 배치는 SMTP 타임아웃 5초 × 100 이라 최악의 경우 몇 분이다.
     * 섞으면 선생님이 명단을 올릴 때마다 학습자료 추출이 그만큼 멈춘다.
     *
     * <p>한 배치가 작업 하나라 스레드 1개로 충분하다. 큐가 차면 CallerRuns 로 되돌린다 —
     * 계정 안내 메일이 조용히 사라지는 것보다 요청이 느려지는 쪽이 낫다.
     */
    @Bean
    public Executor studentMailExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(1);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("mallang-student-mail-");
        executor.setRejectedExecutionHandler(
                new java.util.concurrent.ThreadPoolExecutor.CallerRunsPolicy());
        executor.initialize();
        return executor;
    }
}
