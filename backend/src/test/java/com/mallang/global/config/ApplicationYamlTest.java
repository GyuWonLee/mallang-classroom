package com.mallang.global.config;

import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;
import org.yaml.snakeyaml.error.YAMLException;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * <b>운영 설정 파일이 실제로 읽히는지</b> 검사한다.
 *
 * <p>테스트는 {@code src/test/resources/application.yml} 을 쓰기 때문에, 운영 파일이 깨져도
 * 전부 초록불이다. 그래서 <b>배포에서만 터진다.</b> 실제로 겪었다 — 이미 {@code server:} 블록이
 * 있는데 위쪽에 하나를 더 만들었더니 {@code found duplicate key server} 로 기동이 실패했고,
 * 642개 테스트는 전부 통과했다. 블루-그린이 트래픽을 안 넘겨 서비스는 살았지만, 그건 배포가
 * 막힌 것이지 고쳐진 것이 아니다.</p>
 *
 * <p>YAML 은 최상위 키 중복을 허용하지 않는다. 문서(`---`)가 다르면 같은 키를 다시 쓸 수 있어
 * 눈으로는 헷갈리기 쉽다 — 사람 대신 파서에게 묻는다.</p>
 */
class ApplicationYamlTest {

    /**
     * <b>클래스패스가 아니라 파일 경로로 읽는다.</b> 테스트 실행에서는 test 리소스가 먼저
     * 잡혀 {@code getResourceAsStream("application.yml")} 이 테스트용 파일을 준다 — 검사하려던
     * 바로 그 파일을 비켜 가는 것이다(이 테스트를 쓰면서 실제로 한 번 걸렸다).
     */
    private static final Path PATH = Path.of("src", "main", "resources", "application.yml");

    @Test
    void productionYamlParses() {
        assertThatCode(this::loadDocuments)
                .as("운영 application.yml 이 깨지면 배포에서만 터진다 (테스트는 test 쪽 yml 을 쓴다)")
                .doesNotThrowAnyException();
    }

    /**
     * 배포 중 슬롯을 내릴 때 진행 중인 요청을 끊지 않으려면 이 둘이 함께 있어야 한다.
     *
     * <p>하나만 있으면 조용히 무의미해진다 — {@code shutdown: graceful} 없이 대기 시간만 두면
     * 아무것도 기다리지 않고, 대기 시간 없이 graceful 만 두면 기본값(30초)에 기대게 된다.
     * 통지표 메일이 잘려 "학부모는 받았는데 화면은 실패" 가 나온 자리다.</p>
     */
    @Test
    void gracefulShutdownIsConfigured() {
        Map first = new Map(loadDocuments().get(0));
        assertThat(first.at("server", "shutdown")).isEqualTo("graceful");
        assertThat(first.at("spring", "lifecycle", "timeout-per-shutdown-phase")).isNotNull();
    }

    private List<Object> loadDocuments() {
        if (!Files.isReadable(PATH)) {
            throw new IllegalStateException(PATH.toAbsolutePath() + " 을 찾을 수 없습니다");
        }
        try (InputStream in = Files.newInputStream(PATH)) {
            List<Object> docs = new ArrayList<>();
            /*
              **중복 키를 막도록 명시한다.** SnakeYAML 기본값은 중복을 허용해서(뒤엣것이 이김)
              `new Yaml()` 로는 이 테스트가 아무것도 못 잡는다 — 실제로 한 번 그랬다.
              Spring Boot 는 이 옵션을 꺼서 읽으므로, 여기도 같게 맞춰야 기동과 같은 판정이 된다.
            */
            LoaderOptions options = new LoaderOptions();
            options.setAllowDuplicateKeys(false);
            new Yaml(new SafeConstructor(options)).loadAll(in).forEach(docs::add);
            return docs;
        } catch (YAMLException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException(PATH + " 을 읽지 못했습니다", e);
        }
    }

    /** 중첩 맵에서 경로로 값을 꺼내는 잔가지 — 없으면 null */
    private record Map(Object root) {
        @SuppressWarnings("unchecked")
        Object at(String... path) {
            Object cur = root;
            for (String key : path) {
                if (!(cur instanceof java.util.Map<?, ?> map)) {
                    return null;
                }
                cur = ((java.util.Map<String, Object>) map).get(key);
            }
            return cur;
        }
    }
}
