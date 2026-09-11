# Falmouth Kart - browser prototype

A single-player arcade driving prototype for iPhone/Safari and desktop browsers, set on real Falmouth, Cornwall map data.

## What is real
- OpenStreetMap raster streets and labels
- OpenStreetMap building footprints fetched live via Overpass
- Building heights use mapped heights/storeys when available, otherwise a simple fallback estimate
- A route is requested from the public OSRM routing service, with a built-in fallback line

## What is game logic
- Arcade acceleration, braking and steering
- Off-route speed penalty
- Timed laps and best lap
- iPhone touch controls plus keyboard controls

## Run locally
A web server is recommended because browsers can restrict network requests from file:// pages.

Python 3:

    cd falmouth-kart
    python3 -m http.server 8080

Then open http://localhost:8080

For iPhone testing on the same Wi-Fi network, use your computer's LAN IP instead of localhost.


## Data/licensing note
Map data © OpenStreetMap contributors. OpenStreetMap data is licensed under ODbL. This prototype uses public tile/routing/Overpass endpoints suitable for light testing, not production-scale traffic. A published game should use an appropriate production tile/routing provider or self-hosted services and preserve required attribution.
