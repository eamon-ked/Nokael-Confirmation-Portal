import { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Job } from '../types';
import { Loader2, Navigation, Clock } from 'lucide-react';
import { renderToString } from 'react-dom/server';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || '';

// --- CUSTOM SVG ICONS (L.divIcon) ---
// Pickup (Green)
const pickupIcon = L.divIcon({
  html: renderToString(
    <div className="bg-white p-1 rounded-full shadow-lg border-2 border-nokael-primary flex items-center justify-center">
      <div className="w-4 h-4 text-nokael-primary">
         <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
      </div>
    </div>
  ),
  className: '',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
});

// Delivery (Red)
const deliveryIcon = L.divIcon({
  html: renderToString(
    <div className="bg-white p-1 rounded-full shadow-lg border-2 border-red-500 flex items-center justify-center">
      <div className="w-4 h-4 text-red-500">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
      </div>
    </div>
  ),
  className: '',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
});

// Driver (Pulsing blue Navigation arrow)
const driverIcon = L.divIcon({
  html: renderToString(
    <div className="bg-nokael-primary p-2 rounded-full shadow-xl animate-pulse flex items-center justify-center">
       <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-white"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
    </div>
  ),
  className: '',
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

interface DriverMapProps {
  job: Job;
}

// Utility to calculate distance in meters (Haversine)
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3; // metres
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

// Map Updater Component
function MapUpdater({ center, route }: { center: [number, number], route?: [number, number][] }) {
  const map = useMap();
  
  useEffect(() => {
    if (route && route.length > 0) {
      const bounds = L.latLngBounds(route);
      map.fitBounds(bounds, { padding: [50, 50] });
    } else {
      map.setView(center, map.getZoom());
    }
  }, [center, route, map]);

  return null;
}

export default function DriverMap({ job }: DriverMapProps) {
  const [eta, setEta] = useState<string | null>(null);
  const [routeData, setRouteData] = useState<[number, number][]>([]);
  const lastFetchRef = useRef<{ lat: number; lng: number; time: number } | null>(null);

  const pickup: [number, number] | null = job.pickup_lat && job.pickup_lng ? [job.pickup_lat, job.pickup_lng] : null;
  const delivery: [number, number] | null = job.delivery_lat && job.delivery_lng ? [job.delivery_lat, job.delivery_lng] : null;
  const driver: [number, number] | null = job.driver_lat && job.driver_lng ? [job.driver_lat, job.driver_lng] : null;

  // Decide destination based on job status
  const destination = (job.status === 'pending' || job.status === 'client_pickup') ? pickup : delivery;

  useEffect(() => {
    const fetchRoute = async () => {
      if (!MAPBOX_TOKEN || !driver || !destination) return;

      // Smart Polling Check: Moved > 200m or > 5 minutes
      const now = Date.now();
      if (lastFetchRef.current) {
        const dist = getDistance(driver[0], driver[1], lastFetchRef.current.lat, lastFetchRef.current.lng);
        const timeDiff = now - lastFetchRef.current.time;
        if (dist < 200 && timeDiff < 300000) return; // Skip if criteria not met
      }

      try {
        const query = await fetch(
          `https://api.mapbox.com/directions/v5/mapbox/driving/${driver[1]},${driver[0]};${destination[1]},${destination[0]}?geometries=geojson&access_token=${MAPBOX_TOKEN}`
        );
        const json = await query.json();
        
        if (json.routes && json.routes[0]) {
          const route = json.routes[0];
          // Mapbox returns [lng, lat], Leaflet needs [lat, lng]
          const coords = route.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]);
          setRouteData(coords);
          
          const durationMins = Math.round(route.duration / 60);
          setEta(`${durationMins} MINS`);
          
          lastFetchRef.current = { lat: driver[0], lng: driver[1], time: now };
        }
      } catch (err) {
        console.error('Mapbox fetch error:', err);
      }
    };

    fetchRoute();
  }, [driver, destination]);

  const mapCenter: [number, number] = driver || pickup || [25.2048, 55.2708];

  return (
    <div className="nokael-card !p-0 overflow-hidden border-nokael-border shadow-2xl bg-white group">
      <div className="h-[300px] sm:h-[400px] lg:h-[450px] w-full relative bg-slate-100 transition-all duration-500">
        <MapContainer 
          center={mapCenter} 
          zoom={13} 
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
          attributionControl={false}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          {pickup && <Marker position={pickup} icon={pickupIcon} />}
          {delivery && <Marker position={delivery} icon={deliveryIcon} />}
          {driver && <Marker position={driver} icon={driverIcon} />}
          
          {routeData.length > 0 && (
            <Polyline 
              positions={routeData} 
              pathOptions={{ color: '#0066FF', weight: 4, opacity: 0.7, lineJoin: 'round' }} 
            />
          )}

          <MapUpdater center={mapCenter} route={routeData} />
        </MapContainer>

        {/* TOP OVERLAY: LIVE INDICATOR */}
        <div className="absolute top-6 left-6 z-[1000] flex items-center gap-2.5 bg-white/95 backdrop-blur px-4 py-2 rounded-full border border-nokael-border shadow-xl ring-1 ring-black/5 animate-in slide-in-from-left duration-700">
          <div className="w-2.5 h-2.5 bg-nokael-accent rounded-full animate-pulse shadow-[0_0_12px_rgba(255,165,0,0.5)]" />
          <span className="text-[10px] font-black uppercase text-nokael-primary tracking-[0.2em]">Live Tracking</span>
        </div>

        {/* TOP RIGHT: ETA OVERLAY */}
        {eta && (
          <div className="absolute top-6 right-6 z-[1000] animate-in slide-in-from-right zoom-in duration-500">
            <div className="bg-nokael-primary text-white pl-4 pr-5 py-2.5 rounded-2xl shadow-2xl flex items-center gap-3 border border-white/20">
              <Clock className="w-4 h-4 text-nokael-accent" />
              <div className="flex flex-col">
                <span className="text-[8px] font-black uppercase tracking-widest text-white/60">Estimated Entry</span>
                <span className="text-xs font-black tracking-widest leading-none">{eta}</span>
              </div>
            </div>
          </div>
        )}

        {/* BOTTOM RIGHT: FOCUS ICON */}
        <div className="absolute bottom-6 right-6 z-[1000] animate-in fade-in duration-1000">
           <div className="w-10 h-10 bg-white/95 backdrop-blur rounded-xl border border-nokael-border shadow-lg flex items-center justify-center text-nokael-primary hover:bg-white cursor-pointer transition-colors">
              <Navigation className="w-5 h-5" />
           </div>
        </div>
      </div>

      <div className="p-6 bg-white border-t border-nokael-border flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-nokael-primary/5 rounded-2xl flex items-center justify-center border border-nokael-primary/10 shadow-inner">
            <Navigation className="w-6 h-6 text-nokael-primary" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase text-nokael-primary/40 tracking-[0.15em] mb-0.5">Asset Location Status</p>
            <p className="text-sm font-black text-nokael-primary uppercase">
              {driver ? 'Position Uplink Active' : 'Polling Satellite Signal...'}
            </p>
          </div>
        </div>
        {!driver ? (
          <div className="flex items-center gap-3 bg-nokael-accent/5 px-4 py-2 rounded-xl border border-nokael-accent/10">
            <span className="text-[10px] font-black uppercase text-nokael-accent tracking-widest">Searching...</span>
            <Loader2 className="w-4 h-4 text-nokael-accent animate-spin" />
          </div>
        ) : (
          <div className="flex items-center gap-2 bg-nokael-success/5 px-4 py-2 rounded-xl border border-nokael-success/10">
             <div className="w-1.5 h-1.5 bg-nokael-success rounded-full animate-pulse" />
             <span className="text-[10px] font-black uppercase text-nokael-success tracking-widest">Synced</span>
          </div>
        )}
      </div>
    </div>
  );
}
