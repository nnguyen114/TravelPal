package com.travelpal.optimize;

import jakarta.annotation.PreDestroy;
import com.travelpal.assistant.AiServiceClient;
import java.net.URI;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import tools.jackson.databind.json.JsonMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.QueueDoesNotExistException;

/**
 * SQS in both directions: jobs out to ai-service, results back on a long-polling virtual thread. Where there is no
 * queue service (travelpal.ai.queue=http), each job is posted to ai-service on its own virtual thread instead and the
 * answer is handled exactly like a queued result.
 */
@Component
public class OptimizeQueue {
    public record ResultReceived(String body) {}

    private static final Logger log = LoggerFactory.getLogger(OptimizeQueue.class);
    private final SqsClient sqs;
    private final AiProperties props;
    private final ApplicationEventPublisher events;
    private volatile String jobsUrl;
    private volatile String resultsUrl;
    private volatile boolean running = true;

    private final AiServiceClient ai;
    private final JsonMapper json;

    OptimizeQueue(AiProperties props, ApplicationEventPublisher events, AiServiceClient ai, JsonMapper json) {
        this.props = props;
        this.events = events;
        this.ai = ai;
        this.json = json;
        var builder = SqsClient.builder().region(Region.of(props.region()));
        if (props.sqsEndpoint() != null && !props.sqsEndpoint().isBlank()) {
            // LocalStack: any static credentials work.
            builder.endpointOverride(URI.create(props.sqsEndpoint()))
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("test", "test")));
        } else {
            builder.credentialsProvider(DefaultCredentialsProvider.builder().build());
        }
        this.sqs = builder.build();
    }

    /**
     * A lookup: in AWS the queues (with DLQs) come from Terraform, and CreateQueue with different attributes is
     * rejected. Only a local queue service (LocalStack) has none yet, so it's created there.
     */
    private String url(String name) {
        try {
            return sqs.getQueueUrl(r -> r.queueName(name)).queueUrl();
        } catch (QueueDoesNotExistException e) {
            return sqs.createQueue(r -> r.queueName(name)).queueUrl();
        }
    }

    public void send(String body) {
        if (props.direct()) {
            Thread.ofVirtual().name("optimize-job").start(() -> events.publishEvent(new ResultReceived(runDirect(body))));
            return;
        }
        if (jobsUrl == null) {
            jobsUrl = url(props.jobsQueue());
        }
        sqs.sendMessage(r -> r.queueUrl(jobsUrl).messageBody(body));
    }

    String runDirect(String body) {
        try {
            return ai.call("/internal/optimize", body, new UUID(0, 0), Duration.ofMinutes(3), "The optimizer");
        } catch (RuntimeException e) {
            log.warn("Direct optimize call failed", e);
            return json.writeValueAsString(Map.of("previewId", json.readTree(body).path("previewId").asString(), "status", "FAILED",
                "error", "The optimizer is unavailable right now. Try again in a minute."));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return json.writeValueAsString(Map.of("previewId", json.readTree(body).path("previewId").asString(), "status", "FAILED",
                "error", "The optimizer was interrupted. Try again."));
        }
    }

    @EventListener(ApplicationReadyEvent.class)
    void listen() {
        if (props.direct()) {
            return;
        }
        Thread.ofVirtual().name("optimize-results").start(() -> {
            while (running) {
                try {
                    pollOnce(10);
                } catch (RuntimeException e) {
                    log.warn("Polling optimize results failed; retrying in 5s", e);
                    sleep();
                }
            }
        });
    }

    int pollOnce(int waitSeconds) {
        if (resultsUrl == null) {
            resultsUrl = url(props.resultsQueue());
        }
        var msgs = sqs.receiveMessage(r -> r.queueUrl(resultsUrl).maxNumberOfMessages(10).waitTimeSeconds(waitSeconds)).messages();
        for (Message m : msgs) {
            events.publishEvent(new ResultReceived(m.body()));
            sqs.deleteMessage(r -> r.queueUrl(resultsUrl).receiptHandle(m.receiptHandle()));
        }
        return msgs.size();
    }

    @PreDestroy
    void stop() {
        running = false;
    }

    private void sleep() {
        try {
            Thread.sleep(5000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            running = false;
        }
    }
}
