from urllib.parse import urlparse

import httpx
import pytest

from app import links

PAGE = """<html><head><title>Koffee Mameya Kakeru | Specialty coffee in Kiyosumi</title>
<meta property="og:description" content="A tasting-course coffee bar in Tokyo &amp; more"></head></html>"""
GEOCODED = {"results": [{"name": "Koffee Mameya Kakeru", "lat": 35.68, "lon": 139.79, "place_id": "p9",
                         "address_line2": "Kiyosumi, Tokyo"}]}


def client(routes):
    def handler(request: httpx.Request):
        return routes(request)
    return httpx.Client(transport=httpx.MockTransport(handler))


HOSTS = {"short.link": "93.184.216.1", "site.example": "93.184.216.2", "social.example": "93.184.216.3", "a.example": "93.184.216.4",
         "maps.app.goo.gl": "93.184.216.5", "www.google.com": "93.184.216.6", "google.com.site.example": "93.184.216.7",
         "www.tiktok.com": "93.184.216.8", "vm.tiktok.com": "93.184.216.9", "www.youtube.com": "93.184.216.10",
         "www.instagram.com": "93.184.216.11", "www.yelp.com": "93.184.216.12", "tabelog.com": "93.184.216.13",
         "www.tripadvisor.com": "93.184.216.14", "instagram.com.site.example": "93.184.216.15",
         "notinstagram.com": "93.184.216.16"}
BY_IP = {v: k for k, v in HOSTS.items()}
MAPS_MISS = "This Google Maps link doesn't identify a place we can look up. Type the place name instead."
TOKYO = {"lat": 35.68, "lng": 139.76}


def public(monkeypatch):
    """Answers the public-address check from HOSTS; returns the names it was asked about."""
    checked = []
    monkeypatch.setattr(links, "public_ip", lambda h: checked.append(h) or HOSTS.get(h))
    return checked


def no_claude(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    monkeypatch.setattr(links.claude, "_json_call", lambda *a: 1 / 0)


def host(r: httpx.Request) -> str:
    """Requests go to the pinned IP; the Host header carries the name."""
    assert r.url.host in BY_IP and r.headers["host"] == BY_IP[r.url.host]
    assert r.extensions["sni_hostname"] == r.headers["host"]
    return r.headers["host"]


@pytest.mark.parametrize("url, name, lat, lng", [
    ("https://www.google.com/maps/place/Senso-ji/@35.7148,139.7967,17z", "Senso-ji", 35.7148, 139.7967),
    ("https://google.com/maps/place/Sens%C5%8D-ji/@35.7148,139.7967,17z/data=!3m1?entry=ttu&g_ep=abc", "Sensō-ji", 35.7148, 139.7967),
    ("https://www.google.com/maps/place/浅草寺/@35.7148,139.7967", "浅草寺", 35.7148, 139.7967),
    ("https://maps.google.com/maps/place/A%2BB+Cafe/@-33,151,12z", "A+B Cafe", -33.0, 151.0),
    ("https://www.google.com/maps/place/Edge/@90,-180", "Edge", 90.0, -180.0),
    ("https://www.google.com/maps/place/Edge/@-90.0,180.0/", "Edge", -90.0, 180.0),
])
def test_google_maps_place_links_need_no_fetch(url, name, lat, lng):
    out = links.resolve(url, None, client(lambda r: 1 / 0))
    assert out == {"readable": True, "guess": name, "message": None,
                   "candidates": [{"name": name, "lat": lat, "lng": lng, "providerId": None, "address": ""}]}


@pytest.mark.parametrize("url", [
    "https://www.google.com/maps/place/Edge/@90.1,0",
    "https://www.google.com/maps/place/Edge/@0,180.5",
    "https://www.google.com/maps/place/Edge/@abc,def",
    "https://www.google.com/maps/place/+/@35.7,139.7",
    "https://www.google.com/maps/place/Senso-ji/data=!4m2!3m1",
    "https://www.google.com/maps/dir/Tokyo+Station/Senso-ji",
    "https://www.google.com/maps/@35.7,139.7,15z",
    "https://www.google.com/maps/search/?api=1&query=%20",
    "https://maps.google.com/",
])
def test_maps_links_without_a_place_say_so(url):
    assert links.resolve(url, None, client(lambda r: 1 / 0)) == links.fail(MAPS_MISS)


def test_maps_share_links_follow_redirects_to_the_place(monkeypatch):
    checked = public(monkeypatch)
    no_claude(monkeypatch)
    seen = []

    def routes(r):
        seen.append((host(r), r.url.path))
        if r.url.path == "/abc":
            return httpx.Response(302, headers={"location": "/r/abc"})
        return httpx.Response(301, headers={"location": "https://www.google.com/maps/place/Senso-ji/@35.7148,139.7967,17z?entry=gps"})
    out = links.resolve("https://maps.app.goo.gl/abc", None, client(routes))
    assert out["candidates"] == [{"name": "Senso-ji", "lat": 35.7148, "lng": 139.7967, "providerId": None, "address": ""}]
    assert seen == [("maps.app.goo.gl", "/abc"), ("maps.app.goo.gl", "/r/abc")]  # never the Maps page itself
    assert checked == ["maps.app.goo.gl", "maps.app.goo.gl", "www.google.com"]


def test_maps_share_link_that_leads_elsewhere(monkeypatch):
    public(monkeypatch)
    out = links.resolve("https://maps.app.goo.gl/x", None, client(lambda r: httpx.Response(
        200, text="<title>Consent</title>", headers={"content-type": "text/html"})))
    assert out["message"] == MAPS_MISS


def geoapify(seen, result=GEOCODED):
    def answer(r):
        seen.append((r.url.params["text"], r.url.params.get("bias")))
        return httpx.Response(200, json=result)
    return answer


@pytest.mark.parametrize("url", [
    "https://www.google.com/maps/search/?api=1&query=Ichiran%20Shibuya",
    "https://www.google.com/maps/search?api=1&query=Ichiran+Shibuya&query_place_id=x",
    "https://www.google.com/maps/search/?api=1&query=+&q=Ichiran+Shibuya",
    "https://maps.google.com/?q=Ichiran+Shibuya",
    "https://www.google.com/maps?q=Ichiran%20Shibuya&entry=gps",
])
def test_maps_search_links_search_the_query(url, monkeypatch):
    no_claude(monkeypatch)
    seen = []
    out = links.resolve(url, TOKYO, client(geoapify(seen)))
    assert seen == [("Ichiran Shibuya", "proximity:139.76,35.68")]
    assert out["guess"] == "Ichiran Shibuya" and out["candidates"][0]["providerId"] == "geoapify:p9" and out["message"] is None


def test_maps_search_links_through_a_share_link(monkeypatch):
    public(monkeypatch)
    no_claude(monkeypatch)
    seen = []

    def routes(r):
        if r.url.host == "api.geoapify.com":
            return geoapify(seen)(r)
        assert host(r) == "maps.app.goo.gl"
        return httpx.Response(302, headers={"location": "https://www.google.com/maps/search/?api=1&query=Ichiran%20Shibuya"})
    out = links.resolve("https://maps.app.goo.gl/q", TOKYO, client(routes))
    assert seen == [("Ichiran Shibuya", "proximity:139.76,35.68")] and out["candidates"]


@pytest.mark.parametrize("url", [
    "https://google.com.site.example/maps/place/Senso-ji/@35.7,139.7",
    "https://site.example/r?u=https://www.google.com/maps/place/Senso-ji/@35.7,139.7&q=maps",
])
def test_maps_lookalikes_are_ordinary_pages(url, monkeypatch):
    public(monkeypatch)
    fetched = []

    def routes(r):
        if r.url.host == "api.geoapify.com":
            return httpx.Response(200, json=GEOCODED)
        fetched.append(host(r))
        return httpx.Response(200, text=PAGE, headers={"content-type": "text/html"})
    out = links.resolve(url, None, client(routes))
    assert fetched == [urlparse(url).hostname] and out["guess"] == "Koffee Mameya Kakeru"


def test_reads_a_page_follows_safe_redirects_and_finds_the_place(monkeypatch):
    public(monkeypatch)

    def routes(r):
        if r.url.host == "api.geoapify.com":
            return httpx.Response(200, json=GEOCODED)
        if host(r) == "short.link":
            return httpx.Response(301, headers={"location": "https://site.example/cafe"})
        if host(r) == "site.example":
            return httpx.Response(200, text=PAGE, headers={"content-type": "text/html; charset=utf-8"})
        return httpx.Response(404)
    out = links.resolve("https://short.link/abc", None, client(routes))
    assert out["readable"] and out["guess"] == "Koffee Mameya Kakeru"
    assert out["candidates"][0]["address"] == "Kiyosumi, Tokyo"


def test_uses_claude_when_available(monkeypatch):
    public(monkeypatch)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    monkeypatch.setattr(links.claude, "_json_call", lambda *a: {"place": "Kakeru", "area": "Kiyosumi"})
    seen = []

    def routes(r):
        if r.url.host != "api.geoapify.com" and host(r) == "site.example":
            return httpx.Response(200, text=PAGE, headers={"content-type": "text/html"})
        seen.append(r.url.params["text"])
        return httpx.Response(200, json={"results": []})
    out = links.resolve("https://site.example/p", None, client(routes))
    assert seen == ["Kakeru Kiyosumi", "Kakeru"]
    assert "couldn't find it on the map" in out["message"]


def test_blocks_private_addresses_and_unreadable_pages(monkeypatch):
    public(monkeypatch)
    for url in ("http://internal.local/admin", "file:///etc/passwd"):
        out = links.resolve(url, None, client(lambda r: httpx.Response(200)))
        assert out == {"readable": False, "guess": None, "candidates": [],
                       "message": "That link points somewhere we can't open. Type the place name instead."}
    login = links.resolve("https://social.example/p/1", None, client(lambda r: httpx.Response(403)))
    assert not login["readable"] and "may need a login" in login["message"]
    hop = links.resolve("https://a.example", None, client(lambda r: httpx.Response(302, headers={"location": "http://internal.local/"})))
    assert "can't open" in hop["message"]
    loop = links.resolve("https://a.example", None, client(lambda r: httpx.Response(302, headers={"location": "https://a.example/again"})))
    assert "too many times" in loop["message"]
    for url in ("https://[::1", "https://a.example:99999/", "https://a.example:port/", "https://a.example/\x00"):
        assert links.resolve(url, None, client(lambda r: 1 / 0))["message"].startswith("That link points somewhere")
    big = links.resolve("https://a.example", None, client(lambda r: httpx.Response(
        200, content=b"<title>x</title>" + b" " * links.MAX_BYTES, headers={"content-type": "text/html"})))
    assert big == links.fail("That page couldn't be read (it may need a login). Type the place name instead.")
    down = links.resolve("https://a.example", None, client(lambda r: (_ for _ in ()).throw(httpx.ConnectError("x"))))
    assert "couldn't be reached" in down["message"]


def test_page_without_a_place(monkeypatch):
    public(monkeypatch)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    monkeypatch.setattr(links.claude, "_json_call", lambda *a: {"place": "", "area": ""})
    out = links.resolve("https://site.example", None, client(lambda r: httpx.Response(200, text="<title>News</title>", headers={"content-type": "text/html"})))
    assert out["guess"] is None and "couldn't tell which place" in out["message"]


def test_public_ip_checks_real_dns(monkeypatch):
    assert links.public_ip("localhost") is None
    assert links.public_ip("no-such-host.invalid") is None
    monkeypatch.setattr(links.socket, "getaddrinfo", lambda h, p: [(0, 0, 0, "", ("93.184.216.34", 0)), (0, 0, 0, "", ("10.0.0.5", 0))])
    assert links.public_ip("mixed.example") is None  # one private answer is enough to refuse
    monkeypatch.setattr(links.socket, "getaddrinfo", lambda h, p: [(0, 0, 0, "", ("2606:2800:220:1::1", 0, 0, 0))])
    assert links.public_ip("v6.example") == "2606:2800:220:1::1"


def test_ipv6_and_ports_are_pinned(monkeypatch):
    monkeypatch.setattr(links, "public_ip", lambda h: "2606:2800:220:1::1")
    seen = []

    def routes(r):
        seen.append((str(r.url), r.headers["host"]))
        return httpx.Response(200, text="<title>Café X | Tokyo</title>", headers={"content-type": "text/html"})
    links.fetch("https://user@v6.example:8443/p?q=1", client(routes))
    assert seen == [("https://[2606:2800:220:1::1]:8443/p?q=1", "v6.example:8443")]


def test_place_search_outage_says_so():
    out = links.resolve("https://maps.google.com/?q=Koffee+Mameya", None, client(lambda r: httpx.Response(503)))
    assert out["guess"] == "Koffee Mameya" and out["candidates"] == []
    assert out["message"].startswith("Place search is unavailable right now")


VIDEO_UNCLEAR = "We couldn't tell which place this video is about. Type the place name instead."
VIDEO_BAD = "We couldn't read this video. Type the place name instead."
TIKTOK_ONLY = "Paste a TikTok video link or type the place name instead."
ICHIRAN = {"results": [{"name": "Ichiran Shibuya", "lat": 35.66, "lon": 139.70, "place_id": "ich",
                        "address_line2": "Shibuya, Tokyo"}]}
JSON = {"content-type": "application/json; charset=utf-8"}


def oembed(monkeypatch, answer, place=None, short=None):
    """A video's world: an optional share-link redirect, the oEmbed endpoint, Claude's reading, and Geoapify."""
    public(monkeypatch)
    if place is not None:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
        monkeypatch.setattr(links.claude, "_json_call", lambda system, user, schema: place)
    seen = {"pages": [], "oembed": [], "search": [], "hosts": []}

    def routes(r):
        if r.url.host == "api.geoapify.com":
            seen["search"].append(r.url.params["text"])
            return httpx.Response(200, json=ICHIRAN)
        seen["hosts"].append(host(r))
        if seen["hosts"][-1] == "vm.tiktok.com":
            seen["pages"].append(r.url.path)
            return httpx.Response(301, headers={"location": short})
        assert r.url.path.startswith("/oembed"), "never the video page itself"
        seen["oembed"].append(dict(r.url.params))
        return answer(r) if callable(answer) else answer
    return seen, routes


@pytest.mark.parametrize("url, endpoint, params", [
    ("https://www.tiktok.com/@ramen.fan/video/7106594312292453675?is_from_webapp=1&sender_device=pc", "www.tiktok.com",
     {"url": "https://www.tiktok.com/@ramen.fan/video/7106594312292453675"}),
    ("https://m.tiktok.com/@ramen.fan/video/7106594312292453675/", "www.tiktok.com",
     {"url": "https://www.tiktok.com/@ramen.fan/video/7106594312292453675"}),
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&si=share", "www.youtube.com",
     {"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "format": "json"}),
    ("https://youtu.be/dQw4w9WgXcQ?si=share", "www.youtube.com",
     {"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "format": "json"}),
    ("https://m.youtube.com/shorts/dQw4w9WgXcQ", "www.youtube.com",
     {"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "format": "json"}),
])
def test_videos_are_read_through_oembed(url, endpoint, params, monkeypatch):
    answer = httpx.Response(200, json={"type": "video", "title": "Best ramen at Ichiran in Shibuya!! #tokyo",
                                       "author_name": "ramen.fan", "html": "<script>x</script>"}, headers=JSON)
    seen, routes = oembed(monkeypatch, answer, {"place": "Ichiran", "area": "Shibuya"})
    out = links.resolve(url, TOKYO, client(routes))
    assert seen["hosts"] == [endpoint] and seen["oembed"] == [params]
    assert seen["search"] == ["Ichiran Shibuya"] and out["guess"] == "Ichiran" and out["message"] is None
    assert out["candidates"][0]["name"] == "Ichiran Shibuya"


def test_tiktok_share_links_skip_the_video_page(monkeypatch):
    answer = httpx.Response(200, json={"type": "video", "title": "Ichiran Shibuya ramen at 3am"}, headers=JSON)
    seen, routes = oembed(monkeypatch, answer, {"place": "Ichiran Shibuya", "area": "Tokyo"},
                          short="https://www.tiktok.com/@ramen.fan/video/123?_r=1&_t=x")
    out = links.resolve("https://vm.tiktok.com/ZMabc/", TOKYO, client(routes))
    assert seen["pages"] == ["/ZMabc/"] and seen["oembed"] == [{"url": "https://www.tiktok.com/@ramen.fan/video/123"}]
    assert seen["search"] == ["Ichiran Shibuya"]  # "Tokyo" isn't in the caption, so it doesn't narrow the search
    assert out["candidates"]


@pytest.mark.parametrize("title, place", [
    ("", {"place": "Ichiran", "area": ""}),  # titleless video: Claude isn't even asked
    ("Tokyo food tour vlog", {"place": "", "area": "Tokyo"}),  # generic or several venues: Claude says none
    ("Tokyo food tour vlog", {"place": "ramen.fan", "area": ""}),  # only the creator's name, which isn't in the text
    ("Best bowl of my life", {"place": "Ichiran", "area": "Shibuya"}),  # a name Claude made up
    ("Best ramen at Ichiran", None),  # Claude off: no title fallback for videos
    ("Ichiranramen", {"place": "Ichiran", "area": ""}),  # not a whole phrase in the text
])
def test_videos_without_a_named_place_ask_the_traveler(title, place, monkeypatch):
    answer = httpx.Response(200, json={"type": "video", "title": title, "author_name": "ramen.fan"}, headers=JSON)
    seen, routes = oembed(monkeypatch, answer, place)
    out = links.resolve("https://www.youtube.com/watch?v=dQw4w9WgXcQ", TOKYO, client(routes))
    assert out == links.fail(VIDEO_UNCLEAR, readable=True) and seen["search"] == []


def test_claude_giving_no_answer_asks_the_traveler(monkeypatch):
    _, routes = oembed(monkeypatch, httpx.Response(200, json={"type": "video", "title": "Ichiran"}, headers=JSON))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    monkeypatch.setattr(links.claude, "_json_call", lambda *a: None)
    assert links.resolve("https://youtu.be/dQw4w9WgXcQ", TOKYO, client(routes)) == links.fail(VIDEO_UNCLEAR, readable=True)


@pytest.mark.parametrize("answer", [
    httpx.Response(200, text='{"type": "video", "title": "Ichiran"}', headers={"content-type": "text/html"}),
    httpx.Response(200, text='{"type": "video", "title": "Ichiran"}', headers={"content-type": "application/jsonp"}),
    httpx.Response(200, text='{"type": "video", "title": ', headers=JSON),
    httpx.Response(200, json=["video"], headers=JSON),
    httpx.Response(200, json={"type": "rich", "title": "Ichiran"}, headers=JSON),
    httpx.Response(200, json={"type": "video", "title": 123}, headers=JSON),
    httpx.Response(200, content=b'{"type": "video", "title": "' + b"x" * links.MAX_BYTES + b'"}', headers=JSON),
    httpx.Response(404, json={"error": "gone"}, headers=JSON),
    httpx.Response(302, headers={"location": "https://site.example/oembed"}),
    httpx.Response(302, headers={"location": "http://www.tiktok.com/oembed"}),
])
def test_unreadable_video_metadata(answer, monkeypatch):
    seen, routes = oembed(monkeypatch, answer, {"place": "Ichiran", "area": ""})
    out = links.resolve("https://www.tiktok.com/@ramen.fan/video/123", TOKYO, client(routes))
    assert out == links.fail(VIDEO_BAD) and len(seen["oembed"]) == 1 and seen["search"] == []


def test_oembed_redirects_within_its_origin_are_followed(monkeypatch):
    def answer(r):
        if r.url.path == "/oembed":
            return httpx.Response(302, headers={"location": "/oembed/v2"})
        return httpx.Response(200, json={"type": "video", "title": ""}, headers=JSON)
    seen, routes = oembed(monkeypatch, answer)
    out = links.resolve("https://www.tiktok.com/@a/video/1", None, client(routes))
    assert seen["hosts"] == ["www.tiktok.com", "www.tiktok.com"] and out["message"] == VIDEO_UNCLEAR
    seen, routes = oembed(monkeypatch, httpx.Response(302, headers={"location": "/oembed"}))
    out = links.resolve("https://www.tiktok.com/@a/video/1", None, client(routes))
    assert out["message"].startswith("That link redirects too many")


@pytest.mark.parametrize("url", ["https://www.tiktok.com/@ramen.fan", "https://tiktok.com/@ramen.fan/",
                                 "https://www.tiktok.com/explore", "https://www.tiktok.com/tag/ramen"])
def test_tiktok_links_that_arent_videos(url):
    assert links.resolve(url, None, client(lambda r: 1 / 0)) == links.fail(TIKTOK_ONLY)


def test_tiktok_share_links_to_a_profile_or_elsewhere(monkeypatch):
    seen, routes = oembed(monkeypatch, None, short="https://www.tiktok.com/@ramen.fan?_t=x")
    assert links.resolve("https://vm.tiktok.com/p/", None, client(routes)) == links.fail(TIKTOK_ONLY)
    assert seen["pages"] == ["/p/"] and seen["oembed"] == []
    seen, routes = oembed(monkeypatch, None, short="https://www.tiktok.com/login")
    assert links.resolve("https://vm.tiktok.com/l/", None, client(routes)) == links.fail(VIDEO_BAD)
    seen, routes = oembed(monkeypatch, None, short="https://vm.tiktok.com/again")
    assert links.resolve("https://vm.tiktok.com/l/", None, client(routes))["message"].startswith("That link redirects too many")
    seen, routes = oembed(monkeypatch, None, short="http://internal.local/")
    assert links.resolve("https://vm.tiktok.com/l/", None, client(routes))["message"].startswith("That link points somewhere")


@pytest.mark.parametrize("url", ["https://www.youtube.com/@somechannel", "https://youtu.be/short",
                                 "https://www.youtube.com/watch?v=dQw4w9WgXc!", "https://www.youtube.com/shorts/"])
def test_youtube_links_that_arent_videos(url):
    assert links.resolve(url, None, client(lambda r: 1 / 0)) == links.fail(
        "Paste a YouTube video link or type the place name instead.")


@pytest.mark.parametrize("url, site", [
    ("https://www.instagram.com/p/C0example/", "Instagram"), ("https://instagram.com/reel/x?igsh=abc", "Instagram"),
    ("https://m.facebook.com/story.php?id=1", "Facebook"), ("https://fb.com/x", "Facebook"),
    ("https://fb.watch/abc/", "Facebook"), ("https://www.threads.net/@a/post/1", "Threads"),
    ("https://threads.com/@a", "Threads"), ("https://www.xiaohongshu.com/explore/1", "Xiaohongshu"),
    ("http://xhslink.com/a/b", "Xiaohongshu"),
])
def test_social_sites_are_not_fetched(url, site):
    assert links.resolve(url, None, client(lambda r: 1 / 0)) == links.fail(
        f"We can't read {site} links. Type the place name instead.")


def test_short_links_to_social_sites_stop_before_the_page(monkeypatch):
    public(monkeypatch)
    fetched = []

    def routes(r):
        fetched.append(host(r))
        return httpx.Response(302, headers={"location": "https://www.instagram.com/p/C0example/?igsh=x"})
    out = links.resolve("https://short.link/ig", None, client(routes))
    assert fetched == ["short.link"] and out["message"] == "We can't read Instagram links. Type the place name instead."


@pytest.mark.parametrize("url", ["https://instagram.com.site.example/p/1", "https://notinstagram.com/p/1"])
def test_social_lookalikes_are_ordinary_pages(url, monkeypatch):
    public(monkeypatch)
    out = links.resolve(url, None, client(lambda r: httpx.Response(200, json=GEOCODED) if r.url.host == "api.geoapify.com"
                                          else httpx.Response(200, text=PAGE, headers={"content-type": "text/html"})))
    assert out["guess"] == "Koffee Mameya Kakeru"


@pytest.mark.parametrize("url", ["https://www.google.com/search?q=ichiran+shibuya", "https://google.com/url?q=https://site.example/",
                                 "https://maps.google.com/search?q=x"])
def test_google_search_links_ask_for_a_better_link(url):
    assert links.resolve(url, None, client(lambda r: 1 / 0)) == links.fail(
        "Paste the place's website or Google Maps link, or type the place name instead.")


REVIEW_PAGES = {
    "https://www.yelp.com/biz/ichiran-shibuya": (
        ('<title>ICHIRAN Shibuya - Updated 2026 - 1-22-7 Jinnan, Tokyo - Yelp</title>'
        '<meta name="description" content="Ramen in Shibuya">'), "ICHIRAN Shibuya - Updated 2026"),
    "https://tabelog.com/en/tokyo/A1318/A131802/13001826/": (
        ('<title>Mintei - Shimokitazawa/Chinese | Tabelog</title>'
        '<meta property="og:title" content="Mintei (Shimokitazawa/Chinese)">'), "Mintei (Shimokitazawa/Chinese)"),
    "https://www.tripadvisor.com/Attraction_Review-g1066461-d320047-Reviews-Senso_ji_Temple": (
        ('<title>SENSO-JI TEMPLE (2026) All You Need to Know - Tripadvisor</title>'
        '<meta property="og:description" content="Senso-ji Temple, Taito: tips">'), "Senso-ji Temple, Taito: tips"),
}


@pytest.mark.parametrize("url", REVIEW_PAGES)
def test_review_sites_are_read_like_any_page(url, monkeypatch):
    public(monkeypatch)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    asked = []
    monkeypatch.setattr(links.claude, "_json_call", lambda system, user, schema: asked.append(user) or {"place": "Somewhere", "area": ""})
    page, snippet = REVIEW_PAGES[url]

    def routes(r):
        if r.url.host == "api.geoapify.com":
            return httpx.Response(200, json={"results": []})
        assert host(r) == urlparse(url).hostname
        return httpx.Response(200, text=page, headers={"content-type": "text/html"})
    out = links.resolve(url, None, client(routes))
    assert snippet in asked[0] and out["guess"] == "Somewhere"


@pytest.mark.parametrize("page", [
    "<title>Tripadvisor</title>", "<title>Log in | Yelp</title>", "<title>Just a moment...</title>",
    "<title> </title><meta name='description' content='Access Denied'>", "<html>no title</html>",
    "<title>TikTok - Make Your Day</title>",
])
def test_publisher_names_and_login_walls_name_no_place(page, monkeypatch):
    public(monkeypatch)
    no_claude(monkeypatch)
    out = links.resolve("https://www.yelp.com/biz/x", None, client(
        lambda r: httpx.Response(200, text=page, headers={"content-type": "text/html"})))
    assert out == links.fail("We read the page but couldn't tell which place it's about. Type the place name instead.",
                             readable=True)


def test_without_claude_a_publisher_title_isnt_a_place(monkeypatch):
    public(monkeypatch)
    page = '<title>Tabelog</title><meta name="description" content="Mintei, Chinese food in Shimokitazawa">'
    out = links.resolve("https://tabelog.com/x", None, client(lambda r: httpx.Response(200, text=page, headers={"content-type": "text/html"})))
    assert out["guess"] is None and out["message"].startswith("We read the page but couldn't tell")


def test_page_queries_reach_the_site_but_not_claude(monkeypatch):
    public(monkeypatch)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    asked, fetched = [], []
    monkeypatch.setattr(links.claude, "_json_call", lambda system, user, schema: asked.append(user) or {"place": "", "area": ""})

    def routes(r):
        fetched.append((host(r), r.url.path, r.url.query.decode()))
        if host(r) == "short.link":
            return httpx.Response(302, headers={"location": "https://site.example/menu?id=7&sig=abc#reviews"})
        return httpx.Response(200, text=PAGE, headers={"content-type": "text/html"})
    links.resolve("https://short.link/m?utm_source=x#top", None, client(routes))
    assert fetched == [("short.link", "/m", "utm_source=x"), ("site.example", "/menu", "id=7&sig=abc")]
    assert asked[0].startswith("<url>https://site.example/menu</url>") and "sig" not in asked[0]


def row(name, place_id, address="Shimokitazawa, Setagaya, Tokyo", **extra):
    return {"name": name, "lat": 35.66, "lon": 139.67, "place_id": place_id, "address_line2": address, **extra}


NEAR_MINTEI = [row("Shimokitazawa Station", "st", category="public_transport.train"), row("Mintei Ramen Shop", "shop"),
               row("Café Shimokitazawa", "cafe"), {"address_line1": "Mintei", "lat": 35.66, "lon": 139.67, "place_id": "addr"}]


def inferred(monkeypatch, place, area, *answers, city=""):
    """A page Claude reads as (place, area, city); Geoapify answers each query in turn. Returns the queries and result."""
    public(monkeypatch)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    monkeypatch.setattr(links.claude, "_json_call", lambda *a: {"place": place, "area": area, "city": city})
    queries, answers = [], list(answers)

    def routes(r):
        if r.url.host != "api.geoapify.com":
            return httpx.Response(200, text="<title>Mintei - Shimokitazawa/Chinese | Tabelog</title>",
                                  headers={"content-type": "text/html"})
        queries.append(r.url.params["text"])
        answer = answers.pop(0)
        return answer if isinstance(answer, httpx.Response) else httpx.Response(200, json={"results": answer})
    return queries, links.resolve("https://tabelog.com/en/tokyo/A1318/A131802/13001826/", TOKYO, client(routes))


def test_unrelated_places_near_the_area_are_never_offered(monkeypatch):
    queries, out = inferred(monkeypatch, "Mintei", "Shimokitazawa", NEAR_MINTEI, NEAR_MINTEI)
    assert queries == ["Mintei Shimokitazawa", "Mintei"]
    assert out == {"readable": True, "guess": "Mintei", "candidates": [],
                   "message": "We think it's “Mintei” but couldn't find it on the map. Check the name."}


def test_rejected_results_fall_through_to_the_next_query(monkeypatch):
    queries, out = inferred(monkeypatch, "Mintei", "Shimokitazawa", NEAR_MINTEI, [row("MINTEI", "m")])
    assert queries == ["Mintei Shimokitazawa", "Mintei"] and [p["providerId"] for p in out["candidates"]] == ["geoapify:m"]


def test_only_matching_results_are_kept_in_provider_order(monkeypatch):
    queries, out = inferred(monkeypatch, "Mintei", "Shimokitazawa",
                            [NEAR_MINTEI[0], row("Mintei", "m1"), NEAR_MINTEI[1], row("Mintei Shimokitazawa", "m2")])
    assert queries == ["Mintei Shimokitazawa"] and [p["providerId"] for p in out["candidates"]] == ["geoapify:m1", "geoapify:m2"]


def test_place_without_an_area_is_searched_once(monkeypatch):
    queries, out = inferred(monkeypatch, "Tokyo Tower", "", [row("Tokyo Tower", "tt", "Shibakoen, Minato, Tokyo")])
    assert queries == ["Tokyo Tower"] and out["candidates"][0]["name"] == "Tokyo Tower"


def test_the_neighborhood_not_the_city_picks_the_branch(monkeypatch):
    shinjuku, shibuya = row("Ichiran", "shinjuku", "Kabukicho, Shinjuku, Tokyo"), row("Ichiran", "shibuya", "Jinnan, Shibuya, Tokyo")
    queries, out = inferred(monkeypatch, "Ichiran", "Shibuya", [shinjuku, shibuya], city="Tokyo")
    assert queries == ["Ichiran Shibuya"] and [p["providerId"] for p in out["candidates"]] == ["geoapify:shibuya"]
    queries, out = inferred(monkeypatch, "Ichiran", "Shibuya", [shinjuku], [shinjuku], city="Tokyo")
    assert queries == ["Ichiran Shibuya", "Ichiran"] and out["candidates"] == []  # sharing Tokyo isn't enough
    # an area given as "neighborhood, city" is judged by its neighborhood, for branch names and addresses alike
    branch = row("Ichiran Shibuya Branch", "branch", "Shibuya, Tokyo")
    queries, out = inferred(monkeypatch, "Ichiran", "Shibuya, Tokyo", [shinjuku, branch])
    assert queries == ["Ichiran Shibuya"] and [p["providerId"] for p in out["candidates"]] == ["geoapify:branch"]
    _, out = inferred(monkeypatch, "Sensō-ji", "Asakusa, Tokyo", [row("Sensō-ji", "sj", "1, Asakusa, Taito, Japan")])
    assert out["candidates"]


@pytest.mark.parametrize("area, city", [("", "Tokyo"), ("Tokyo", "Tokyo"), ("tokyo", "TOKYO")])
def test_a_city_alone_asks_nothing_of_the_address(area, city, monkeypatch):
    queries, out = inferred(monkeypatch, "Tokyo Tower", area, [row("Tokyo Tower", "tt", "Parc de Shiba, Minato, Japan")], city=city)
    assert queries == ["Tokyo Tower"] and out["candidates"][0]["name"] == "Tokyo Tower"


def test_search_outage_on_either_query_says_so(monkeypatch):
    outage = "Place search is unavailable right now, so we couldn't find it on the map. Try again in a minute."
    for answers in ([httpx.Response(503)], [NEAR_MINTEI, httpx.Response(503)]):
        _, out = inferred(monkeypatch, "Mintei", "Shimokitazawa", *answers)
        assert out == {"readable": True, "guess": "Mintei", "candidates": [], "message": outage}


@pytest.mark.parametrize("name, address, place, area", [
    ("CAFE MINTEI", "", "Café Mintei", ""),
    ("Café-Mintei!", "", "cafe mintei", ""),
    ("ｍｉｎｔｅｉ", "", "Mintei", ""),  # full-width compatibility forms
    ("珈琲店", "", "珈琲店", ""),
    ("がっこう", "", "がっこう", ""),
    ("Ichiran Shibuya Branch", "", "Ichiran", "Shibuya"),
    ("ICHIRAN Shibuya", "", "Ichiran", "Shibuya"),
    ("一蘭 渋谷店", "", "一蘭", "渋谷"),
    ("一蘭渋谷店", "", "一蘭", "渋谷"),
    ("Ichiran", "Jinnan, Shibuya, Tokyo", "Ichiran", "Shibuya"),  # the bare name, with the area in its address
    ("Ichiran Shibuya", "Jinnan, Shibuya, Tokyo", "Ichiran Shibuya", "Shibuya"),
    ("Sensō Ji", "1, Asakusa, Taito, Japan", "Sensō-ji", "Asakusa"),
])
def test_names_that_are_the_place(name, address, place, area):
    assert links.same_place({"name": name, "address": address}, place, area)


@pytest.mark.parametrize("name, address, place, area", [
    ("珈琲館", "", "珈琲店", ""),  # one character apart in another script
    ("かっこう", "", "がっこう", ""),  # marks matter outside Latin
    ("Minte", "", "Mintei", ""),
    ("Mintei Ramen", "", "Mintei", ""),  # extra words
    ("Shimokitazawa Mintei Building", "", "Mintei", ""),
    ("Min", "", "Mintei", ""),
    ("Shimokitazawa Station", "", "Mintei", "Shimokitazawa"),
    ("Ichiran Shinjuku", "", "Ichiran", "Shibuya"),  # a different branch
    ("Ichiran", "Kabukicho, Shinjuku, Tokyo", "Ichiran", "Shibuya"),  # the bare name in the wrong area
    ("Ichiran", "", "Ichiran", "Shibuya"),  # the bare name with no area evidence
    ("Ichiran", "Shibuya, Tokyo", "Ichiran Shibuya", ""),  # a named branch can't fall back to the chain
    ("Ichiran Shinjuku", "", "Ichiran Shibuya", "Shibuya"),
    ("!!", "", "!!", ""),
])
def test_names_that_are_not_the_place(name, address, place, area):
    assert not links.same_place({"name": name, "address": address}, place, area)
