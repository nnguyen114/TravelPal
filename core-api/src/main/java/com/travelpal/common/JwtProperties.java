package com.travelpal.common;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("travelpal.jwt")
public record JwtProperties(String privateKey, String publicKey, Duration accessTtl, Duration refreshTtl) {}
