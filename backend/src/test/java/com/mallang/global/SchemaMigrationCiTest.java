package com.mallang.global;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * 마이그레이션·스키마 정합성 검사 (CI 전용).
 *
 * <p>{@link MigrationVersionTest} 는 파일명의 버전 중복만 본다. 정작 SQL 이 유효한지,
 * 엔티티가 그 스키마와 맞는지는 실제 Postgres 없이는 알 수 없어 배포에서야 드러났다.
 * 여기서는 {@code ci} 프로필로 진짜 Postgres 에 Flyway 를 걸고
 * {@code ddl-auto: validate} 로 엔티티를 대조한다 — 컨텍스트가 뜨면 통과다.</p>
 *
 * <p>DB_HOST 가 있을 때만 돈다. Jenkins 는 일회용 Postgres 컨테이너를 띄우며 이 값을
 * 이미 넘기고 있고, 로컬에서는 값이 없어 자동으로 건너뛴다
 * (직접 돌리려면 {@code DB_HOST=localhost ./gradlew test}).</p>
 */
@SpringBootTest
@ActiveProfiles("ci")
@EnabledIfEnvironmentVariable(named = "DB_HOST", matches = ".+")
class SchemaMigrationCiTest {

    @Test
    @DisplayName("마이그레이션이 전부 적용되고 엔티티 매핑이 스키마와 일치한다")
    void migrationsApplyAndEntitiesMatchSchema() {
        // 검증은 컨텍스트 기동 자체가 한다:
        //   Flyway migrate 실패 → SQL 오류
        //   Hibernate validate 실패 → 엔티티와 스키마 불일치
    }
}
