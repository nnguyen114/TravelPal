package com.travelpal.place;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;
import org.springframework.http.MediaType;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class PlaceControllerTest {
    static final String PHOTON = """
        {"features":[{"geometry":{"coordinates":[139.7967,35.7148]},
          "properties":{"name":"Senso-ji","street":"Asakusa","city":"Tokyo","country":"Japan","osm_type":"W","osm_id":123}},
          {"geometry":{"coordinates":[139.7967,35.7148]},"properties":{"name":"Senso-ji","osm_type":"W","osm_id":123}}]}""";

    @Test
    void mapsPhotonFeaturesAndPassesBias() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("http://photon.test/api/?q=senso&limit=8&lang=en&lat=35.7&lon=139.8")).andRespond(withSuccess(PHOTON, MediaType.APPLICATION_JSON));
        server.expect(requestTo("http://photon.test/api/?q=x&limit=8&lang=en")).andRespond(withSuccess("{\"features\":[]}", MediaType.APPLICATION_JSON));

        PlaceController c = new PlaceController(builder, "http://photon.test");
        List<PlaceController.Place> places = c.search("senso", 35.7, 139.8);
        assertThat(places).containsExactly(new PlaceController.Place("Senso-ji", "Asakusa, Tokyo, Japan", 35.7148, 139.7967, "osm:W123"));
        assertThat(c.search("x", 35.7, null)).isEmpty();
        server.verify();
    }
}
