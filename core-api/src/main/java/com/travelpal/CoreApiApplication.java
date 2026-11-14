package com.travelpal;

import com.travelpal.history.TripStream;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
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
        String db = System.getenv("DATABASE_URL");
        if (db != null && !db.isBlank() && System.getenv("DB_URL") == null) {
            fromDatabaseUrl(db).forEach(System::setProperty);
        }
        SpringApplication.run(CoreApiApplication.class, args);
    }

    /** Hosts like Render hand out postgres://user:password@host:port/db; Spring wants a JDBC URL plus credentials. */
    static Map<String, String> fromDatabaseUrl(String url) {
        URI u = URI.create(url);
        String[] user = u.getRawUserInfo().split(":", 2);
        String jdbc = "jdbc:postgresql://" + u.getHost() + (u.getPort() > 0 ? ":" + u.getPort() : "") + u.getRawPath()
            + (u.getRawQuery() != null ? "?" + u.getRawQuery() : "");
        return Map.of("spring.datasource.url", jdbc,
            "spring.datasource.username", URLDecoder.decode(user[0], StandardCharsets.UTF_8),
            "spring.datasource.password", user.length > 1 ? URLDecoder.decode(user[1], StandardCharsets.UTF_8) : "");
    }
}
