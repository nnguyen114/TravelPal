package com.travelpal.common;

import static org.assertj.core.api.Assertions.assertThat;

import java.security.KeyPairGenerator;
import java.security.spec.ECGenParameterSpec;
import java.time.Duration;
import java.util.Base64;
import org.junit.jupiter.api.Test;

class SecurityConfigTest {
    @Test
    void loadsConfiguredPemKeys() throws Exception {
        var gen = KeyPairGenerator.getInstance("EC");
        gen.initialize(new ECGenParameterSpec("secp256r1"));
        var pair = gen.generateKeyPair();
        String priv = "-----BEGIN PRIVATE KEY-----\n" + Base64.getMimeEncoder().encodeToString(pair.getPrivate().getEncoded()) + "\n-----END PRIVATE KEY-----";
        String pub = "-----BEGIN PUBLIC KEY-----\n" + Base64.getMimeEncoder().encodeToString(pair.getPublic().getEncoded()) + "\n-----END PUBLIC KEY-----";

        var key = new SecurityConfig().signingKey(new JwtProperties(priv, pub, Duration.ofMinutes(15), Duration.ofDays(30)));
        assertThat(key.getKeyID()).isEqualTo("k1");
        assertThat(key.toECPublicKey()).isEqualTo(pair.getPublic());
    }
}
