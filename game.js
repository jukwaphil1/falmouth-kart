(() => {
  'use strict';

  const START = { lng: -5.06207, lat: 50.15105, heading: 219 };
  const FALLBACK_ROUTE = [
    [-5.06207,50.15105],[-5.06410,50.14965],[-5.06635,50.14790],[-5.06895,50.14585],
    [-5.07210,50.14490],[-5.07510,50.14710],[-5.07410,50.15005],[-5.07080,50.15220],
    [-5.06650,50.15220],[-5.06227,50.15125],[-5.06207,50.15105]
  ];

  const map = new maplibregl.Map({
    container: 'map',
    center: [START.lng, START.lat],
    zoom: 16.8,
    pitch: 67,
    bearing: START.heading,
    attributionControl: true,
    style: {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors'
        }
      },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
    }
  });

  const status = document.getElementById('status');
  const speedEl = document.getElementById('speed');
  const startOverlay = document.getElementById('start');
  const message = document.getElementById('message');

  let pos = { ...START };
  let speed = 0;              // metres per second
  let running = false;
  let last = performance.now();
  let lapStart = 0;
  let bestLap = null;
  let armedForFinish = false;
  let route = FALLBACK_ROUTE;
  const keys = { left:false, right:false, go:false, brake:false };

  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;

  function distanceM(a,b) {
    const R = 6371000;
    const p1 = toRad(a.lat), p2 = toRad(b.lat);
    const dp = toRad(b.lat-a.lat), dl = toRad(b.lng-a.lng);
    const h = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
  }

  function movePoint(p, metres, headingDeg) {
    const R = 6378137;
    const br = toRad(headingDeg);
    const lat1 = toRad(p.lat), lon1 = toRad(p.lng);
    const d = metres / R;
    const lat2 = Math.asin(Math.sin(lat1)*Math.cos(d)+Math.cos(lat1)*Math.sin(d)*Math.cos(br));
    const lon2 = lon1 + Math.atan2(Math.sin(br)*Math.sin(d)*Math.cos(lat1),Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));
    return { lat:toDeg(lat2), lng:toDeg(lon2) };
  }

  function flash(text) {
    message.textContent = text;
    message.style.opacity = 1;
    setTimeout(() => message.style.opacity = 0, 900);
  }

  async function fetchBuildings() {
    const bbox = '50.142,-5.083,50.161,-5.055';
    const q = `[out:json][timeout:20];way[building](${bbox});out geom;`;
    const url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q);
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('Overpass HTTP ' + r.status);
      const data = await r.json();
      const features = data.elements
        .filter(e => e.geometry && e.geometry.length > 2)
        .map(e => {
          const coords = e.geometry.map(p => [p.lon,p.lat]);
          if (coords[0][0] !== coords.at(-1)[0] || coords[0][1] !== coords.at(-1)[1]) coords.push(coords[0]);
          const levels = Number(e.tags?.['building:levels'] || 2);
          const explicit = parseFloat(e.tags?.height);
          const height = Number.isFinite(explicit) ? explicit : Math.min(22, Math.max(4, levels * 3.1));
          return { type:'Feature', properties:{height}, geometry:{type:'Polygon',coordinates:[coords]} };
        });
      map.addSource('buildings',{ type:'geojson', data:{type:'FeatureCollection',features} });
      map.addLayer({
        id:'buildings', type:'fill-extrusion', source:'buildings', minzoom:14,
        paint:{
          'fill-extrusion-color':'#d6d2c5',
          'fill-extrusion-height':['get','height'],
          'fill-extrusion-base':0,
          'fill-extrusion-opacity':0.74
        }
      });
      status.textContent = `Real Falmouth loaded - ${features.length.toLocaleString()} buildings`;
    } catch (e) {
      status.textContent = 'Map loaded - building feed unavailable';
      console.warn(e);
    }
  }

  function addRoute(data) {
    if (map.getSource('race-route')) map.getSource('race-route').setData(data);
    else {
      map.addSource('race-route',{type:'geojson',data});
      map.addLayer({
        id:'race-route',type:'line',source:'race-route',
        paint:{'line-color':'#f0d13d','line-width':7,'line-opacity':0.88}
      });
    }
  }

  async function buildRoute() {
    // Waypoints chosen to form a compact town/harbour/Pendennis-side loop.
    const wp = [
      [-5.06227,50.15125],[-5.06450,50.14950],[-5.06720,50.14710],
      [-5.07120,50.14500],[-5.07510,50.14820],[-5.07250,50.15160],[-5.06750,50.15240],[-5.06227,50.15125]
    ];
    const coords = wp.map(p=>p.join(',')).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;
    try {
      const r = await fetch(url);
      const data = await r.json();
      if (!data.routes?.[0]?.geometry) throw new Error('No route');
      route = data.routes[0].geometry.coordinates;
      addRoute({type:'Feature',properties:{},geometry:data.routes[0].geometry});
    } catch (e) {
      addRoute({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:FALLBACK_ROUTE}});
      console.warn('Using fallback route',e);
    }
  }

  function nearestRouteDistance(p) {
    let best = Infinity;
    for (let i=0;i<route.length;i+=Math.max(1,Math.floor(route.length/250))) {
      const d = distanceM(p,{lng:route[i][0],lat:route[i][1]});
      if (d<best) best=d;
    }
    return best;
  }

  function bindButton(id,key) {
    const el = document.getElementById(id);
    const on = e => { e.preventDefault(); keys[key]=true; };
    const off = e => { e.preventDefault(); keys[key]=false; };
    ['pointerdown','touchstart'].forEach(t=>el.addEventListener(t,on,{passive:false}));
    ['pointerup','pointercancel','pointerleave','touchend','touchcancel'].forEach(t=>el.addEventListener(t,off,{passive:false}));
  }
  bindButton('left','left'); bindButton('right','right'); bindButton('go','go'); bindButton('brake','brake');

  addEventListener('keydown',e=>{
    if (['ArrowLeft','a','A'].includes(e.key)) keys.left=true;
    if (['ArrowRight','d','D'].includes(e.key)) keys.right=true;
    if (['ArrowUp','w','W'].includes(e.key)) keys.go=true;
    if (['ArrowDown','s','S',' '].includes(e.key)) keys.brake=true;
  });
  addEventListener('keyup',e=>{
    if (['ArrowLeft','a','A'].includes(e.key)) keys.left=false;
    if (['ArrowRight','d','D'].includes(e.key)) keys.right=false;
    if (['ArrowUp','w','W'].includes(e.key)) keys.go=false;
    if (['ArrowDown','s','S',' '].includes(e.key)) keys.brake=false;
  });

  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05,(now-last)/1000 || 0); last=now;
    if (!running) return;

    const routeDist = nearestRouteDistance(pos);
    const offRoad = routeDist > 24;
    const maxSpeed = offRoad ? 11 : 23; // 25 or 51 mph-ish

    if (keys.go) speed += 8.2*dt;
    else speed -= 2.4*dt;
    if (keys.brake) speed -= 14*dt;
    speed = Math.max(0,Math.min(maxSpeed,speed));

    const steer = (keys.left?-1:0)+(keys.right?1:0);
    const steerRate = 78 * (0.24 + Math.min(1,speed/10));
    pos.heading += steer*steerRate*dt;

    const np = movePoint(pos,speed*dt,pos.heading);
    pos.lng=np.lng; pos.lat=np.lat;

    map.jumpTo({center:[pos.lng,pos.lat],bearing:pos.heading,pitch:67,zoom:16.8});
    const mph = Math.round(speed*2.23694);
    speedEl.textContent = mph + ' mph';

    const dStart = distanceM(pos,START);
    if (dStart > 120) armedForFinish = true;
    if (armedForFinish && dStart < 18 && speed > 2) {
      const lap = (now-lapStart)/1000;
      if (lap > 15) {
        if (bestLap===null || lap<bestLap) bestLap=lap;
        flash(`LAP ${lap.toFixed(1)}s`);
        lapStart=now; armedForFinish=false;
      }
    }
    const t = (now-lapStart)/1000;
    const best = bestLap ? ` - best ${bestLap.toFixed(1)}s` : '';
    status.textContent = `${offRoad?'OFF ROUTE - ':''}lap ${t.toFixed(1)}s${best}`;
  }

  map.on('load', async () => {
    await buildRoute();
    fetchBuildings();
  });

  document.getElementById('play').addEventListener('click',()=>{
    startOverlay.style.display='none';
    running=true; lapStart=performance.now(); last=performance.now();
    flash('GO');
  });

  requestAnimationFrame(tick);
})();
