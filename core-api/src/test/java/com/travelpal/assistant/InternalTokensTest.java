package com.travelpal.assistant;

import static org.assertj.core.api.Assertions.assertThat;

import com.nimbusds.jose.jwk.Curve;
import com.nimbusds.jose.jwk.gen.ECKeyGenerator;
import java.util.Map;
import org.junit.jupiter.api.Test;

class InternalTokensTest {
    @Test
    void configuredKeySurvivesRestartsAndPublishesOnlyThePublicHalf() throws Exception {
        String jwk = new ECKeyGenerator(Curve.P_256).keyID("k-prod").generate().toJSONString();
        Map<String, Object> a = new InternalTokens(jwk, false).jwks();
        Map<String, Object> b = new InternalTokens(jwk, false).jwks();
        assertThat(a).isEqualTo(b);
        @SuppressWarnings("unchecked")
        Map<String, Object> published = ((java.util.List<Map<String, Object>>) a.get("keys")).get(0);
        assertThat(published).containsEntry("kid", "k-prod").doesNotContainKey("d");
        assertThat(new InternalTokens("", true).jwks()).isNotEqualTo(a);
    }

    @Test
    void refusesToStartWithoutKeyOutsideDev() {
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> new InternalTokens("", false)).hasMessageContaining("INTERNAL_JWT_PRIVATE_JWK");
    }
}
