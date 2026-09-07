package com.mallang.assignment.material;

import com.mallang.assignment.ai.AiProperties;
import com.mallang.assignment.ai.ResolvedMaterial;
import com.mallang.global.error.ApiException;
import com.mallang.material.entity.Material;
import com.mallang.material.repository.MaterialRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.util.StreamUtils;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 생성 grounding 자료 해석기. 두 종류의 자료를 섞어 받는다:
 * <ul>
 *   <li>내장 어휘 자료 {@code builtin-korean-g{1..6}} — 서버 리소스, 항상 READY 취급 (명세 6.5).
 *       학년별 기본 자료라 자료를 따로 안 고른 생성의 기준이 된다.</li>
 *   <li>업로드 학습자료(숫자 id) — MATERIAL 테이블의 추출 텍스트 (선생님이 올린 PDF 등)</li>
 * </ul>
 *
 * <p>업로드 자료는 (1) 요청 학급 소속이어야 하고 (2) 상태가 READY여야 한다
 * (명세 §7: 전부 READY여야 생성 가능). 아니면 각각 404/409로 막는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MaterialSource {

    private static final String BUILTIN_KOREAN_PREFIX = "builtin-korean-g";
    private static final Pattern BUILTIN_KOREAN = Pattern.compile(BUILTIN_KOREAN_PREFIX + "([1-6])");

    /**
     * 프롬프트에 실을 분량 — 설정값이다({@code ai.material.*}).
     *
     * <p>{@code material.extracted_text} 는 상한 없는 {@code text} 컬럼이라 스캔 학습지 한 권이면
     * 수만 자가 들어간다. 그대로 붙이면 게이트웨이가 400 을 주고, 그 원본 응답 문자열이
     * {@code GenerationJobRunner} 의 catch 를 타고 {@code job.error} 에 실려 <b>선생님 화면에
     * 영어 오류로 뜬다.</b> 그래서 상한은 두되, <b>값은 환경마다 다르므로</b> 설정으로 뺀다.</p>
     */
    private final MaterialRepository materialRepository;
    private final AiProperties aiProperties;

    private int maxCharsTotal() {
        return aiProperties.material().maxCharsTotal();
    }

    private int maxCharsPerMaterial() {
        return aiProperties.material().maxCharsPerMaterial();
    }

    /** 내장 자료는 서버 리소스라 런타임에 바뀌지 않는다 → id별로 한 번만 읽어 재사용(매 요청 디스크 I/O 제거). */
    private final Map<String, ResolvedMaterial> builtinCache = new ConcurrentHashMap<>();

    /** 학년별 내장 국어 자료 id — 호출부가 문자열을 직접 조립하지 않도록 한곳에서 만든다. */
    public static String builtinKoreanId(int grade) {
        return BUILTIN_KOREAN_PREFIX + grade;
    }

    /**
     * @param classroomId 생성이 일어나는 학급 — 업로드 자료가 이 학급 소속인지 검증한다.
     *                    (내장 자료는 학급과 무관하므로 검증하지 않는다.)
     */
    public List<ResolvedMaterial> resolve(Long classroomId, List<String> materialIds) {
        List<ResolvedMaterial> materials = new ArrayList<>(materialIds.size());
        for (String id : materialIds) {
            materials.add(resolveOne(classroomId, id));
        }
        return capToBudget(materials, classroomId);
    }

    /**
     * 합계 상한을 <b>고른 자료에 고루 나눈다.</b>
     *
     * <p>예전에는 앞에서부터 자료당 상한(8,000자)을 그대로 떼어 갔다. 그러면 세 번째쯤에서
     * 예산이 바닥나고 <b>나머지는 통째로 빠진다</b> — 실제로 자료 6개를 고른 요청에서 5개가
     * 제외됐고, 남은 내용만으로는 문항을 만들 수 없어 생성이 거절됐다. 선생님은 여섯 개를
     * 골랐는데 하나로 만든 셈이니, 결과가 기대와 다른 것은 물론이고 왜 그런지도 알 수 없다.</p>
     *
     * <p>대신 <b>짧은 자료부터</b> 몫을 준다(max-min 배분). 각자 "남은 예산 / 남은 자료 수"와
     * 자료당 상한 중 작은 만큼 가져가는데, 그보다 짧은 자료는 제 길이만큼만 쓰고 남긴다.
     * 남은 몫은 뒤의 긴 자료들이 다시 나눠 갖는다 — 예산을 버리지 않으면서 모든 자료가
     * 최소한 자기 몫은 싣는다.</p>
     *
     * <p>순서는 <b>고른 순서 그대로</b> 돌려준다. 배분하려고 정렬한 것을 그대로 내보내면
     * 프롬프트에서 자료 순서가 뒤바뀌어, 선생님이 먼저 고른 자료가 뒤로 밀린다.</p>
     */
    private List<ResolvedMaterial> capToBudget(List<ResolvedMaterial> materials, Long classroomId) {
        int count = materials.size();
        if (count == 0) {
            return materials;
        }

        // 짧은 것부터 몫을 정한다 — 남기는 쪽을 먼저 처리해야 그 여유가 뒤로 흘러간다
        List<Integer> order = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            order.add(i);
        }
        order.sort(Comparator.comparingInt(i -> materials.get(i).text().length()));

        int[] allowed = new int[count];
        int remaining = maxCharsTotal();
        int left = count;
        for (int i : order) {
            int share = Math.min(maxCharsPerMaterial(), remaining / left);
            int take = Math.min(materials.get(i).text().length(), share);
            allowed[i] = take;
            remaining -= take;
            left -= 1;
        }

        List<ResolvedMaterial> out = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            ResolvedMaterial material = materials.get(i);
            if (allowed[i] <= 0) {
                /* 자료 수가 예산보다 많아 한 글자도 못 싣는 경우 — 빈 자료를 보내지는 않는다 */
                log.warn("생성 입력 합계 상한({}자)을 자료 수로 나누어도 몷서 제외한다. "
                                + "classroomId={} materialId={} 자료수={}",
                        maxCharsTotal(), classroomId, material.materialId(), count);
                continue;
            }
            out.add(capped(material, allowed[i], classroomId));
        }
        return out;
    }

    /**
     * 상한을 넘으면 자른다. 자를 때는 <b>문단 경계에서</b> 끊는다 — 문장 중간에서 끊으면
     * 모델이 잘린 조각을 문제로 만들 수 있다.
     *
     * <p>잘린 사실은 로그로 남긴다. 초안에 "일부만 참고했다"고 실어 선생님에게 보여 주는
     * 것까지는 초안 스키마와 화면을 함께 고쳐야 해서 별도 과제로 둔다 — 다만 조용히
     * 자르지는 않는다.
     */
    private ResolvedMaterial capped(ResolvedMaterial material, int allowed, Long classroomId) {
        String text = material.text();
        if (text.length() <= allowed) {
            return material;
        }
        int cut = text.lastIndexOf("\n", allowed);
        String head = text.substring(0, cut > allowed / 2 ? cut : allowed);
        log.warn("생성 입력 상한으로 자료를 잘랐다. classroomId={} materialId={} {}자 → {}자",
                classroomId, material.materialId(), text.length(), head.length());
        return new ResolvedMaterial(material.materialId(), material.title(), head);
    }

    private ResolvedMaterial resolveOne(Long classroomId, String id) {
        Matcher builtin = BUILTIN_KOREAN.matcher(id);
        if (builtin.matches()) {
            String grade = builtin.group(1);
            // 이미 읽은 학년 자료는 캐시에서 즉시 반환, 없을 때만 리소스에서 로드.
            return builtinCache.computeIfAbsent(id, key -> loadBuiltinKorean(grade, key));
        }
        return resolveUploaded(classroomId, id);
    }

    /** 학년별 내장 국어 어휘 자료 — 캐시 미스일 때만 클래스패스 리소스에서 읽는다. */
    private ResolvedMaterial loadBuiltinKorean(String grade, String id) {
        String text = loadClasspathText("materials/" + BUILTIN_KOREAN_PREFIX + grade + ".txt", id);
        return new ResolvedMaterial(id, "국어 " + grade + "학년 기본 어휘", text);
    }

    /** 업로드 학습자료 — 숫자 id로 MATERIAL 조회 → 학급 소속·READY 검증 → 추출 텍스트 반환. */
    private ResolvedMaterial resolveUploaded(Long classroomId, String id) {
        long materialId = parseId(id);
        // 소프트삭제(@SQLRestriction) 자동 제외. 다른 학급 자료는 존재를 숨겨 404로 처리.
        Material material = materialRepository.findById(materialId)
                .filter(m -> m.getClassroom().getId().equals(classroomId))
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "material-not-found",
                        "학습자료를 찾을 수 없습니다: " + id));

        if (!material.getStatus().usableForGeneration()) {
            throw new ApiException(HttpStatus.CONFLICT, "material-not-ready",
                    "아직 생성에 쓸 수 없는 자료입니다 (상태: " + material.getStatus()
                            + "). 미리보기 확인(READY) 후 사용하세요: " + id);
        }
        String text = material.getExtractedText();
        if (text == null || text.isBlank()) {
            throw new ApiException(HttpStatus.CONFLICT, "material-not-ready",
                    "추출된 텍스트가 비어 있어 생성에 쓸 수 없습니다: " + id);
        }
        return new ResolvedMaterial(id, material.getTitle(), text);
    }

    private long parseId(String id) {
        try {
            return Long.parseLong(id);
        } catch (NumberFormatException e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid-material-id",
                    "학습자료 id 형식이 올바르지 않습니다: " + id
                            + " (내장 자료 builtin-korean-g1~g6, 또는 업로드 자료의 숫자 id)");
        }
    }

    private String loadClasspathText(String path, String id) {
        ClassPathResource resource = new ClassPathResource(path);
        if (!resource.exists()) {
            throw new ApiException(HttpStatus.CONFLICT, "material-not-ready",
                    "내장 학습자료를 찾을 수 없습니다: " + id);
        }
        try (var in = resource.getInputStream()) {
            return StreamUtils.copyToString(in, StandardCharsets.UTF_8);
        } catch (IOException e) {
            log.error("내장 학습자료 읽기 실패: {}", path, e);
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "material-read-failed",
                    "학습자료를 읽는 중 오류가 발생했습니다.");
        }
    }
}
