package com.travelpal.optimize;

import jakarta.annotation.PreDestroy;
import java.net.URI;
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

/** SQS in both directions: jobs out to ai-service, results back on a long-polling virtual thread. */
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

    OptimizeQueue(AiProperties props, ApplicationEventPublisher events) {
        this.props = props;
        this.events = events;
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

    /** Idempotent lookup; in AWS the queues (with DLQs) come from Terraform. */
    private String url(String name) {
        return sqs.createQueue(r -> r.queueName(name)).queueUrl();
    }

    public void send(String body) {
        if (jobsUrl == null) {
            jobsUrl = url(props.jobsQueue());
        }
        sqs.sendMessage(r -> r.queueUrl(jobsUrl).messageBody(body));
    }

    @EventListener(ApplicationReadyEvent.class)
    void listen() {
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
