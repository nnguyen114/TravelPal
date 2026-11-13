package com.travelpal;

import com.travelpal.history.TripStream;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.context.annotation.Bean;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@ConfigurationPropertiesScan
@EnableScheduling
public class CoreApiApplication {
    @Bean
    RedisMessageListenerContainer redisListeners(RedisConnectionFactory redis, TripStream stream) {
        var c = new RedisMessageListenerContainer();
        c.setConnectionFactory(redis);
        c.addMessageListener(stream, new ChannelTopic(TripStream.CHANNEL));
        return c;
    }

    public static void main(String[] args) {
        SpringApplication.run(CoreApiApplication.class, args);
    }
}
