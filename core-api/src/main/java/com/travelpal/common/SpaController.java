package com.travelpal.common;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * When the web app is bundled into this service (the Render image), its client-side routes load index.html.
 * Static files and "/" are served by Spring Boot directly; in AWS the app is on CloudFront instead.
 */
@Controller
class SpaController {
    @GetMapping({"/login", "/signup", "/trips/**", "/join/**"})
    String app() {
        return "forward:/index.html";
    }
}
