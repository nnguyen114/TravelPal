package com.travelpal.place;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.travelpal.common.Counters;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class PlaceControllerTest {
    static final String PHOTON = """
        {"features":[{"geometry":{"coordinates":[139.7967,35.7148]},
          "properties":{"name":"Senso-ji","street":"Asakusa","city":"Tokyo","country":"Japan","osm_type":"W","osm_id":123}},
          {"geometry":{"coordinates":[139.7967,35.7148]},"properties":{"name":"Senso-ji","osm_type":"W","osm_id":123}},
          {"geometry":{"coordinates":[139.7,35.7]},"properties":{"street":"No name street","osm_type":"N","osm_id":7}}]}""";

    @Test
    void searchesPhotonAndCapsEachAccount() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("http://photon.test/api/?q=senso&limit=8&lang=en&lat=35.7&lon=139.8")).andRespond(withSuccess(PHOTON, MediaType.APPLICATION_JSON));
        server.expect(requestTo("http://photon.test/api/?q=x&limit=8&lang=en")).andRespond(withSuccess("{\"features\":[]}", MediaType.APPLICATION_JSON));
        server.expect(requestTo("http://photon.test/api/?q=down&limit=8&lang=en")).andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS));

        Counters counters = mock(Counters.class);
        when(counters.allow(any(), anyInt(), any())).thenReturn(true, true, true, false);
        Jwt jwt = Jwt.withTokenValue("t").header("alg", "ES256").subject(UUID.randomUUID().toString()).build();
        PlaceController c = new PlaceController(new PlaceSearch(builder, "http://photon.test"), counters);

        // Duplicates and nameless results (bare addresses) are dropped.
        List<PlaceSearch.Place> places = c.search(jwt, "senso", 35.7, 139.8);
        assertThat(places).containsExactly(new PlaceSearch.Place("Senso-ji", "Asakusa, Tokyo, Japan", 35.7148, 139.7967, "osm:W123"));
        assertThat(c.search(jwt, "x", 35.7, null)).isEmpty();
        // A throttled or failing provider is "unavailable", not "no results".
        assertThatThrownBy(() -> c.search(jwt, "down", null, null)).hasMessageContaining("503").hasMessageContaining("unavailable");
        server.verify();
        assertThatThrownBy(() -> c.search(jwt, "y", null, null)).hasMessageContaining("429");
    }
}
