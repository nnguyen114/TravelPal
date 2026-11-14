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
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class PlaceControllerTest {
    static final String GEOCODED = """
        {"results":[{"name":"Senso-ji","address_line2":"Asakusa, Tokyo, Japan","lat":35.7148,"lon":139.7967,"place_id":"abc"},
          {"name":"Senso-ji","lat":35.7148,"lon":139.7967,"place_id":"abc"},
          {"address_line1":"Lisbon","address_line2":"Portugal","lat":38.7,"lon":-9.1,"place_id":"lis"},
          {"lat":1,"lon":2,"place_id":"nameless"}]}""";

    final Jwt jwt = Jwt.withTokenValue("t").header("alg", "ES256").subject(UUID.randomUUID().toString()).build();

    @Test
    void searchesTheGeocoderAndCapsEachAccount() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("https://geo.test/v1/geocode/search?text=senso&format=json&limit=8&lang=en&apiKey=k&bias=proximity:139.8,35.7"))
            .andRespond(withSuccess(GEOCODED, MediaType.APPLICATION_JSON));
        server.expect(requestTo("https://geo.test/v1/geocode/search?text=down&format=json&limit=8&lang=en&apiKey=k"))
            .andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS));
        Counters counters = mock(Counters.class);
        when(counters.allow(any(), anyInt(), any())).thenReturn(true, true, false);
        PlaceController c = new PlaceController(new PlaceSearch(builder, "https://geo.test", "k"), counters);

        // Duplicates and nameless results are dropped; a place with no name uses its first address line.
        assertThat(c.search(jwt, "senso", 35.7, 139.8)).containsExactly(
            new PlaceSearch.Place("Senso-ji", "Asakusa, Tokyo, Japan", 35.7148, 139.7967, "geoapify:abc"),
            new PlaceSearch.Place("Lisbon", "Portugal", 38.7, -9.1, "geoapify:lis"));
        // A throttled or failing provider is "unavailable", not "no results".
        assertThatThrownBy(() -> c.search(jwt, "down", null, null)).hasMessageContaining("503").hasMessageContaining("unavailable");
        server.verify();
        assertThatThrownBy(() -> c.search(jwt, "y", null, null)).hasMessageContaining("429");
    }

    @Test
    void withoutAKeySearchIsUnavailable() {
        PlaceSearch places = new PlaceSearch(RestClient.builder(), "https://geo.test", "");
        assertThatThrownBy(() -> places.search("x", null, null)).hasMessageContaining("503");
    }
}
