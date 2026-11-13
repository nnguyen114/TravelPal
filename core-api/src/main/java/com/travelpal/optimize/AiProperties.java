package com.travelpal.optimize;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("travelpal.ai")
public record AiProperties(String serviceUrl, String sqsEndpoint, String region, String jobsQueue, String resultsQueue) {}
