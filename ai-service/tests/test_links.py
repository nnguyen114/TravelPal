import httpx

from app import links

PAGE = """<html><head><title>Koffee Mameya Kakeru | Specialty coffee in Kiyosumi</title>
<meta property="og:description" content="A tasting-course coffee bar in Tokyo &amp; more"></head></html>"""
PHOTON = {"features": [{"geometry": {"coordinates": [139.79, 35.68]},
                        "properties": {"name": "Koffee Mameya Kakeru", "osm_type": "N", "osm_id": 9, "district": "Kiyosumi", "city": "Tokyo"}}]}


def client(routes):
    def handler(request: httpx.Request):
        return routes(request)
    return httpx.Client(transport=httpx.MockTransport(handler))


def public(monkeypatch):
    monkeypatch.setattr(links, "public_host", lambda h: h != "internal.local")


def test_google_maps_links_need_no_fetch():
    out = links.resolve("https://www.google.com/maps/place/Senso-ji/@35.7148,139.7967,17z", None, client(lambda r: 1 / 0))
    assert out["guess"] == "Senso-ji" and out["candidates"][0]["lat"] == 35.7148


def test_maps_search_links_search_the_query(monkeypatch):
    out = links.resolve("https://maps.google.com/?q=Koffee+Mameya", {"lat": 35.68, "lng": 139.76},
                        client(lambda r: httpx.Response(200, json=PHOTON)))
    assert out["guess"] == "Koffee Mameya" and out["candidates"][0]["providerId"] == "osm:N9"


def test_reads_a_page_follows_safe_redirects_and_finds_the_place(monkeypatch):
    public(monkeypatch)

    def routes(r):
        if r.url.host == "short.link":
            return httpx.Response(301, headers={"location": "https://site.example/cafe"})
        if r.url.host == "site.example":
            return httpx.Response(200, text=PAGE, headers={"content-type": "text/html; charset=utf-8"})
        return httpx.Response(200, json=PHOTON)
    out = links.resolve("https://short.link/abc", None, client(routes))
    assert out["readable"] and out["guess"] == "Koffee Mameya Kakeru"
    assert out["candidates"][0]["address"] == "Kiyosumi, Tokyo"


def test_uses_claude_when_available(monkeypatch):
    public(monkeypatch)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    monkeypatch.setattr(links.claude, "_json_call", lambda *a: {"place": "Kakeru", "area": "Kiyosumi"})
    seen = []

    def routes(r):
        if r.url.host == "site.example":
            return httpx.Response(200, text=PAGE, headers={"content-type": "text/html"})
        seen.append(r.url.params["q"])
        return httpx.Response(200, json={"features": []})
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


def test_public_host_checks_real_dns():
    assert links.public_host("localhost") is False
    assert links.public_host("no-such-host.invalid") is False
