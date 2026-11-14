import httpx

from app import links

PAGE = """<html><head><title>Koffee Mameya Kakeru | Specialty coffee in Kiyosumi</title>
<meta property="og:description" content="A tasting-course coffee bar in Tokyo &amp; more"></head></html>"""
GEOCODED = {"results": [{"name": "Koffee Mameya Kakeru", "lat": 35.68, "lon": 139.79, "place_id": "p9",
                         "address_line2": "Kiyosumi, Tokyo"}]}


def client(routes):
    def handler(request: httpx.Request):
        return routes(request)
    return httpx.Client(transport=httpx.MockTransport(handler))


HOSTS = {"short.link": "93.184.216.1", "site.example": "93.184.216.2", "social.example": "93.184.216.3", "a.example": "93.184.216.4"}
BY_IP = {v: k for k, v in HOSTS.items()}


def public(monkeypatch):
    monkeypatch.setattr(links, "public_ip", lambda h: HOSTS.get(h))


def host(r: httpx.Request) -> str:
    """Requests go to the pinned IP; the Host header carries the name."""
    assert r.url.host in BY_IP and r.headers["host"] == BY_IP[r.url.host]
    assert r.extensions["sni_hostname"] == r.headers["host"]
    return r.headers["host"]


def test_google_maps_links_need_no_fetch():
    out = links.resolve("https://www.google.com/maps/place/Senso-ji/@35.7148,139.7967,17z", None, client(lambda r: 1 / 0))
    assert out["guess"] == "Senso-ji" and out["candidates"][0]["lat"] == 35.7148


def test_maps_search_links_search_the_query(monkeypatch):
    out = links.resolve("https://maps.google.com/?q=Koffee+Mameya", {"lat": 35.68, "lng": 139.76},
                        client(lambda r: httpx.Response(200, json=GEOCODED)))
    assert out["guess"] == "Koffee Mameya" and out["candidates"][0]["providerId"] == "geoapify:p9"


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
