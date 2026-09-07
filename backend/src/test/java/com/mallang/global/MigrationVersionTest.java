package com.mallang.global;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 마이그레이션 버전 중복 감시.
 *
 * <p>브랜치를 병렬로 파면 각자 다음 번호를 잡아 같은 버전이 두 개 생기기 쉽다. 파일명이 다르니
 * git 은 충돌 없이 머지하지만 Flyway 는 기동 시 "Found more than one migration with version N"
 * 으로 죽는다 — 빌드는 초록불인데 배포만 실패해서 원인을 찾기 어렵다. 여기서 미리 잡는다.</p>
 */
class MigrationVersionTest {

    private static final Path MIGRATION_DIR = Path.of("src/main/resources/db/migration");

    @Test
    @DisplayName("마이그레이션 버전 번호는 중복되지 않는다")
    void versionsAreUnique() throws IOException {
        try (Stream<Path> files = Files.list(MIGRATION_DIR)) {
            Map<String, List<String>> byVersion = files
                    .map(path -> path.getFileName().toString())
                    .filter(name -> name.startsWith("V") && name.contains("__"))
                    .collect(Collectors.groupingBy(name -> name.substring(1, name.indexOf("__"))));

            assertThat(byVersion).isNotEmpty();
            assertThat(byVersion).allSatisfy((version, names) ->
                    assertThat(names).as("V%s 를 여러 마이그레이션이 쓰고 있다", version).hasSize(1));
        }
    }
}
