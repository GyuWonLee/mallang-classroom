package com.mallang.file.tts;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(TtsProperties.class)
public class TtsConfig {
}
