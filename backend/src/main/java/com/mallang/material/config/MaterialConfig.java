package com.mallang.material.config;

import com.mallang.material.service.VisionExtractionProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/** 학습자료 설정 바인딩 (mallang.material.vision.*) */
@Configuration
@EnableConfigurationProperties(VisionExtractionProperties.class)
public class MaterialConfig {
}
