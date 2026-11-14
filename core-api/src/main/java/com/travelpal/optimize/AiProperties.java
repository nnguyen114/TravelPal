package com.travelpal.optimize;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("travelpal.ai")
public record AiProperties(String serviceUrl, String sqsEndpoint, String region, String jobsQueue, String resultsQueue, String queue) {
    /** "http": no queue service (e.g. Render); jobs go straight to ai-service and the answer comes back on the call. */
    public boolean direct() {
        return "http".equalsIgnoreCase(queue);
    }
}
